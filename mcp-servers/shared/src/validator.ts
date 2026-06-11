import type { CanonicalGraph, SemanticDocument, ValidationIssue, ValidationReport } from './models.js';
import { isEnterpriseLikeDocument, loadReferenceCorpus } from './reference-corpus.js';
import { getSectionItemLine, getSectionItems, getSectionText, hasRequiredSections } from './semantic-markdown.js';

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

  if (containsAny(combined, ['ui', 'api', 'role', 'permission']) && !containsAny(combined, ['authorization', 'role', 'permission'])) {
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

function assessQuality(document: SemanticDocument, issues: ValidationIssue[]): void {
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
}

export function validateSemanticDocument(
  document: SemanticDocument,
  graph: CanonicalGraph,
  options?: { policyText?: string },
): ValidationReport {
  const issues: ValidationIssue[] = [];

  assessSectionCompleteness(document, issues);
  assessQuality(document, issues);
  assessContradictions(document, issues);
  assessSecurity(document, options?.policyText, issues);
  assessDependencies(document, issues);

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
