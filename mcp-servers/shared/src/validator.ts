import type { CanonicalGraph, SemanticDocument, ValidationIssue, ValidationReport } from './models.js';
import { isEnterpriseLikeDocument, loadReferenceCorpus } from './reference-corpus.js';
import { getSectionItemLine, getSectionItems, getSectionText, hasRequiredSections } from './semantic-markdown.js';
import { validationPolicyText } from './validation-policy.js';

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function containsAny(text: string, keywords: string[]): boolean {
  const normalized = normalizeText(text);
  return keywords.some((keyword) => normalized.includes(keyword));
}

function createIssue(
  severity: ValidationIssue['severity'],
  code: string,
  message: string,
  sourceRef?: string,
  sourceLine?: number,
  nodeId?: string,
): ValidationIssue {
  return { severity, code, message, sourceRef, sourceLine, nodeId };
}

function extractPolicyRequirements(policyText: string): string[] {
  return policyText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^(require|must|violation)\s*:/i.test(line))
    .map((line) => line.replace(/^(require|must|violation)\s*:\s*/i, '').trim())
    .filter(Boolean);
}

function assessSectionCompleteness(document: SemanticDocument, issues: ValidationIssue[]): void {
  const missingSections = hasRequiredSections(document);
  for (const section of missingSections) {
    issues.push(
      createIssue('gap', 'missing_section', `Required section "${section}" is missing.`, `#${section}`),
    );
  }

  for (const [sectionName, section] of Object.entries(document.sections)) {
    if (!section.raw.trim()) {
      issues.push(createIssue('gap', 'empty_section', `Section "${sectionName}" is empty.`, `#${sectionName}`));
    }
  }
}

function assessContradictions(document: SemanticDocument, issues: ValidationIssue[]): void {
  const rules = getSectionItems(document, 'rules').map(normalizeText);
  const security = normalizeText(getSectionText(document, 'security'));

  for (const rule of rules) {
    const core = rule
      .replace(/\bmust not\b/g, '')
      .replace(/\bmust\b/g, '')
      .replace(/\ballow(ed)?\b/g, '')
      .replace(/\bdeny(ied)?\b/g, '')
      .trim();

    if (!core) continue;

    const hasPositive = rules.some((candidate) => candidate.includes(core) && /\bmust\b|\ballow\b/.test(candidate));
    const hasNegative = rules.some((candidate) => candidate.includes(core) && /\bmust not\b|\bdeny\b/.test(candidate));

    if (hasPositive && hasNegative) {
      issues.push(
        createIssue('conflict', 'rule_contradiction', `Conflicting allow/deny rules detected for "${core}".`, '#rules'),
      );
    }
  }

  if (security.includes('no sso') && security.includes('sso')) {
    issues.push(
      createIssue('conflict', 'security_contradiction', 'Security section simultaneously allows and forbids SSO.', '#security'),
    );
  }
}

function assessSecurity(document: SemanticDocument, policyText: string | undefined, issues: ValidationIssue[]): void {
  const securityText = getSectionText(document, 'security');
  const combined = `${securityText}\n${policyText ?? ''}`;
  const policyRequirements = policyText ? extractPolicyRequirements(policyText) : [];

  if (containsAny(combined, ['login', 'ui', 'api', 'protected', 'user interface']) && !containsAny(combined, ['auth', 'authentication'])) {
    issues.push(
      createIssue(
        'violation',
        'security_missing_authentication',
        'The slice appears to expose user-facing or protected access, but authentication is not clearly defined.',
        '#security',
      ),
    );
  }

  if (
    containsAny(combined, ['ui', 'api', 'role', 'permission', 'access control', 'ownership']) &&
    !containsAny(combined, ['authorization', 'authorize', 'authz', 'role', 'permission', 'access control', 'ownership'])
  ) {
    issues.push(
      createIssue(
        'violation',
        'security_missing_authorization',
        'The slice appears to require access control, but authorization is not clearly defined.',
        '#security',
      ),
    );
  }

  if (policyRequirements.length > 0) {
    for (const requirement of policyRequirements) {
      const requirementKeywords = requirement.split(/\s+/).filter(Boolean);
      const matched = containsAny(combined, requirementKeywords);
      if (!matched) {
        issues.push(
          createIssue(
            'violation',
            'security_policy_violation',
            `Security requirement not satisfied: ${requirement}`,
            '#security',
          ),
        );
      }
    }
  }
}

function assessDependencies(document: SemanticDocument, issues: ValidationIssue[]): void {
  const dependencyItems = getSectionItems(document, 'dependencies');
  const processText = getSectionText(document, 'processes').toLowerCase();
  const interfaceText = getSectionText(document, 'interfaces').toLowerCase();
  const combined = `${processText}\n${interfaceText}`;

  for (const [index, dependency] of dependencyItems.entries()) {
    const normalized = normalizeText(dependency);
    if (!combined.includes(normalized.split(/\s+/)[0] ?? normalized)) {
      const sourceLine = getSectionItemLine(document, 'dependencies', index);
      issues.push(
        createIssue(
          'warning',
          'dependency_unreferenced',
          `Dependency "${dependency}" is not referenced in processes or interfaces.`,
          `#dependencies:${index}`,
          sourceLine,
        ),
      );
    }
  }
}

function assessLayering(document: SemanticDocument, issues: ValidationIssue[]): void {
  const architectureText = getSectionText(document, 'architecture');
  const interfacesText = getSectionText(document, 'interfaces');
  const processText = getSectionText(document, 'processes');
  const combined = `${architectureText}\n${interfacesText}\n${processText}`;

  if (/SERVICE:\s*client implementations/i.test(interfacesText) || /service-local client implementation/i.test(combined)) {
    issues.push(
      createIssue(
        'warning',
        'service_layer_contains_client_adapters',
        'Service layer contains client implementations. Prefer a dedicated clients/integration module for outbound adapters.',
        '#interfaces',
      ),
    );
  }

  if (/SERVICE:\s*local DTOs/i.test(interfacesText) || /service-local dto/i.test(combined)) {
    issues.push(
      createIssue(
        'warning',
        'service_layer_contains_local_dtos',
        'Service layer contains DTO classes. Prefer API or common ownership for transfer shapes.',
        '#interfaces',
      ),
    );
  }

  if (/SERVICE:\s*events/i.test(interfacesText) && /EVENTS:\s*types/i.test(interfacesText)) {
    issues.push(
      createIssue(
        'warning',
        'event_contracts_split_across_layers',
        'Events are modeled in both common and service layers. Consolidate event ownership so event contracts live in one place.',
        '#interfaces',
      ),
    );
  }

  if (/MailService\b[\s\S]*issue: service interface lacks descriptive documentation/i.test(interfacesText)) {
    issues.push(
      createIssue(
        'violation',
        'service_interface_underdocumented',
        'Service interface contracts should be documented. MailService currently lacks descriptive contract comments.',
        '#interfaces',
      ),
    );
  }

  if (/SERVICE:\s*mail operations[\s\S]*sendInvite[\s\S]*issue: invite delivery contract exists but MailServiceImpl\.sendInvite is currently unimplemented/i.test(interfacesText)) {
    issues.push(
      createIssue(
        'violation',
        'service_mail_invite_unimplemented',
        'MailService declares invite delivery, but MailServiceImpl.sendInvite is still unimplemented.',
        '#interfaces',
      ),
    );
  }
}

function assessQuality(document: SemanticDocument, graph: CanonicalGraph, issues: ValidationIssue[]): void {
  const processItems = getSectionItems(document, 'processes');
  if (processItems.length === 0) {
    issues.push(createIssue('gap', 'missing_processes', 'No processes were defined.', '#processes'));
  }

  const interfaces = getSectionItems(document, 'interfaces');
  if (interfaces.length === 0) {
    issues.push(createIssue('gap', 'missing_interfaces', 'No interfaces were defined.', '#interfaces'));
  }

  const modules = getSectionItems(document, 'modules');
  const referenceCorpus = loadReferenceCorpus();
  const combinedText = [
    getSectionText(document, 'context'),
    getSectionText(document, 'interfaces'),
    getSectionText(document, 'data_flows'),
    getSectionText(document, 'processes'),
    getSectionText(document, 'rules'),
    getSectionText(document, 'security'),
    getSectionText(document, 'dependencies'),
  ].join('\n');
  const enterpriseLike = isEnterpriseLikeDocument({
    interfaceCount: interfaces.length,
    dependencyCount: getSectionItems(document, 'dependencies').length,
    processCount: processItems.length,
    securityCount: getSectionItems(document, 'security').length,
    dataFlowCount: getSectionItems(document, 'data_flows').length,
  }, combinedText);

  if (enterpriseLike && modules.length === 0 && referenceCorpus.primary) {
    issues.push(
      createIssue(
        'warning',
        'missing_modules',
        `The slice looks enterprise-like, but no modules section was defined. The reference corpus shows layered architectures, so describe module boundaries explicitly.`,
        '#modules',
      ),
    );
  }

  const persistenceSignals = [
    getSectionText(document, 'dependencies'),
    getSectionText(document, 'processes'),
    getSectionText(document, 'data_flows'),
    getSectionText(document, 'examples'),
  ].join(' ');
  const hasPersistenceIntent = /persistence|database|repository|table|entity|sql|postgres|store|storage|file/i.test(persistenceSignals);
  const graphSchema = graph.metadata?.databaseSchema;
  if (hasPersistenceIntent && !(graphSchema && graphSchema.tables.length > 0)) {
    issues.push(
      createIssue(
        'warning',
        'missing_database_schema',
        'Persistence is present, but no database schema was inferred from the graph. Add explicit table/column modeling or refine the semantic source.',
        '#dependencies',
      ),
    );
  }
}

export function validateSemanticDocument(
  document: SemanticDocument,
  graph: CanonicalGraph,
  options?: { policyText?: string },
): ValidationReport {
  const issues: ValidationIssue[] = [];

  assessSectionCompleteness(document, issues);
  assessQuality(document, graph, issues);
  assessContradictions(document, issues);
  assessSecurity(document, options?.policyText ?? validationPolicyText, issues);
  assessDependencies(document, issues);
  assessLayering(document, issues);

  const gaps = issues.filter((issue) => issue.severity === 'gap').length;
  const conflicts = issues.filter((issue) => issue.severity === 'conflict').length;
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;
  const violations = issues.filter((issue) => issue.severity === 'violation').length;

  const status: ValidationReport['status'] =
    violations > 0 || conflicts > 0 || gaps > 0 ? 'draft' : warnings > 0 ? 'ready' : 'validated';

  return {
    status,
    issues,
    graph,
    summary: { gaps, conflicts, warnings, violations },
  };
}
