import { join } from 'node:path';
import type { CanonicalGraph, CompilerOptions, GeneratedArtifactSet } from './models.js';
import { getWorkspaceRoot, writeTextFile } from './paths.js';

function pascalCase(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

function camelCase(value: string): string {
  const pascal = pascalCase(value);
  return pascal ? pascal.charAt(0).toLowerCase() + pascal.slice(1) : 'application';
}

function packagePath(basePackage: string): string {
  return basePackage.replace(/\./g, '/');
}

function javaPackage(basePackage: string): string {
  return basePackage;
}

function inferArtifactName(graph: CanonicalGraph, fallback = 'SemanticApplication'): string {
  return graph.metadata.title ? pascalCase(graph.metadata.title) : fallback;
}

function inferBasePackage(graph: CanonicalGraph, requested?: string): string {
  if (requested) return requested;
  const title = graph.metadata.title || 'semantic.app';
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return `com.generated.${slug || 'semantic'}`;
}

function collectNames(graph: CanonicalGraph, type: string): string[] {
  return graph.nodes.filter((node) => node.type === type).map((node) => node.name);
}

function renderPomXml(artifactName: string, basePackage: string, graph: CanonicalGraph): string {
  const needsJpa = graph.nodes.some((node) => node.type === 'ExternalSystem' && /database|sql|jdbc|relational/i.test(node.name));
  const needsMessaging = graph.nodes.some((node) => node.type === 'ExternalSystem' && /kafka|mq|queue|messaging|event/i.test(node.name));

  const extraDeps: string[] = [];
  if (needsJpa) {
    extraDeps.push(`
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-data-jpa</artifactId>
    </dependency>`);
  }
  if (needsMessaging) {
    extraDeps.push(`
    <dependency>
      <groupId>org.springframework.kafka</groupId>
      <artifactId>spring-kafka</artifactId>
    </dependency>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <groupId>${basePackage}</groupId>
  <artifactId>${artifactName}</artifactId>
  <version>0.1.0-SNAPSHOT</version>
  <name>${artifactName}</name>
  <description>Generated Spring Boot skeleton from semantic model</description>

  <properties>
    <java.version>17</java.version>
    <maven.compiler.source>17</maven.compiler.source>
    <maven.compiler.target>17</maven.compiler.target>
  </properties>

  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.4.0</version>
    <relativePath/>
  </parent>

  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-security</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-actuator</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-validation</artifactId>
    </dependency>
    ${extraDeps.join('\n    ')}
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-test</artifactId>
      <scope>test</scope>
    </dependency>
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
      </plugin>
    </plugins>
  </build>
</project>
`;
}

function renderApplicationClass(basePackage: string, artifactName: string): string {
  const appClass = `${pascalCase(artifactName)}Application`;
  return `package ${javaPackage(basePackage)};

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class ${appClass} {
    public static void main(String[] args) {
        SpringApplication.run(${appClass}.class, args);
    }
}
`;
}

function renderSecurityConfig(basePackage: string): string {
  return `package ${javaPackage(basePackage)}.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
public class SecurityConfig {

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable())
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/actuator/health").permitAll()
                .anyRequest().authenticated()
            )
            .httpBasic(Customizer.withDefaults());
        return http.build();
    }
}
`;
}

function renderController(basePackage: string, artifactName: string, processes: string[]): string {
  const className = `${pascalCase(artifactName)}Controller`;
  const path = `/${camelCase(artifactName)}`;
  const hasReview = processes.some((name) => /review|manual/i.test(name));
  const hasProcess = processes.some((name) => /process|transform|ingest/i.test(name));

  const methods: string[] = [];
  if (hasProcess) {
    methods.push(`
    @PostMapping("/process")
    public String process(@RequestBody(required = false) String body) {
        return "process accepted";
    }`);
  }
  if (hasReview) {
    methods.push(`
    @PostMapping("/review")
    public String review(@RequestBody(required = false) String body) {
        return "review accepted";
    }`);
  }
  methods.push(`
    @GetMapping("/health")
    public String health() {
        return "ok";
    }`);

  return `package ${javaPackage(basePackage)}.controller;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("${path}")
public class ${className} {
${methods.join('\n')}
}
`;
}

function renderService(basePackage: string, artifactName: string, processes: string[]): string {
  const className = `${pascalCase(artifactName)}Service`;
  const methods = processes.length
    ? processes.map((name) => {
        const methodName = camelCase(name);
        return `
    public String ${methodName}() {
        return "${name}";
    }`;
      })
    : [`
    public String execute() {
        return "service";
    }`];

  return `package ${javaPackage(basePackage)}.service;

import org.springframework.stereotype.Service;

@Service
public class ${className} {
${methods.join('\n')}
}
`;
}

function renderModel(basePackage: string, artifactName: string): string {
  const className = `${pascalCase(artifactName)}Document`;
  return `package ${javaPackage(basePackage)}.model;

public class ${className} {
    private String id;
    private String status;

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }
}
`;
}

function renderProperties(): string {
  return `spring:
  application:
    name: generated-semantic-application
server:
  port: 8080
management:
  endpoints:
    web:
      exposure:
        include: health,info
`;
}

function renderReadme(artifactName: string, graph: CanonicalGraph): string {
  const interfaces = collectNames(graph, 'Interface').map((name) => `- ${name}`).join('\n');
  const dependencies = collectNames(graph, 'Dependency').map((name) => `- ${name}`).join('\n');
  const externalSystems = collectNames(graph, 'ExternalSystem').map((name) => `- ${name}`).join('\n');
  return `# ${artifactName}

Generated Spring Boot skeleton produced from the canonical semantic graph.

## Detected interfaces
${interfaces || '- none'}

## Detected dependencies
${dependencies || '- none'}

## Detected external systems
${externalSystems || '- none'}

## Notes

- This is a limited MVP generation target.
- Manual refinement may be needed for project-specific endpoints and infrastructure wiring.
`;
}

export function generateSpringBootSkeleton(
  graph: CanonicalGraph,
  options: CompilerOptions = {},
): GeneratedArtifactSet {
  const artifactName = inferArtifactName(graph, options.artifactName);
  const basePackage = inferBasePackage(graph, options.basePackage);
  const workspaceRoot = getWorkspaceRoot(options.workspaceRoot);
  const outputDir = options.outputDir || join(workspaceRoot, '.ai-native', 'generated', artifactName);
  const rootPackagePath = packagePath(basePackage);
  const processes = collectNames(graph, 'Process');
  const files = [
    { path: join(outputDir, 'pom.xml'), content: renderPomXml(artifactName, basePackage, graph) },
    { path: join(outputDir, 'README.md'), content: renderReadme(artifactName, graph) },
    {
      path: join(outputDir, 'src/main/resources/application.yml'),
      content: renderProperties(),
    },
    {
      path: join(outputDir, `src/main/java/${rootPackagePath}/${pascalCase(artifactName)}Application.java`),
      content: renderApplicationClass(basePackage, artifactName),
    },
    {
      path: join(outputDir, `src/main/java/${rootPackagePath}/config/SecurityConfig.java`),
      content: renderSecurityConfig(basePackage),
    },
    {
      path: join(outputDir, `src/main/java/${rootPackagePath}/controller/${pascalCase(artifactName)}Controller.java`),
      content: renderController(basePackage, artifactName, processes),
    },
    {
      path: join(outputDir, `src/main/java/${rootPackagePath}/service/${pascalCase(artifactName)}Service.java`),
      content: renderService(basePackage, artifactName, processes),
    },
    {
      path: join(outputDir, `src/main/java/${rootPackagePath}/model/${pascalCase(artifactName)}Document.java`),
      content: renderModel(basePackage, artifactName),
    },
  ];

  return { outputDir, files };
}

export async function persistGeneratedSpringBootSkeleton(
  generated: GeneratedArtifactSet,
  artifactName: string,
  workspaceRoot?: string,
): Promise<{ manifestPath: string; writtenFiles: string[] }> {
  const root = getWorkspaceRoot(workspaceRoot);
  const writtenFiles: string[] = [];
  for (const file of generated.files) {
    await writeTextFile(file.path, file.content);
    writtenFiles.push(file.path);
  }

  const manifestPath = join(root, '.ai-native', 'generated', `${artifactName.replace(/[^a-zA-Z0-9._-]+/g, '-').toLowerCase()}.json`);
  await writeTextFile(
    manifestPath,
    JSON.stringify(
      {
        artifactName,
        outputDir: generated.outputDir,
        files: generated.files.map((file) => file.path),
      },
      null,
      2,
    ),
  );

  return { manifestPath, writtenFiles };
}
