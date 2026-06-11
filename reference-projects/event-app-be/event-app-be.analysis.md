# event-app-be reference analysis

## Architecture shape
- modules: 11
- controllers: 21
- services: 32
- repositories: 27
- entities: 5
- policies: 5
- configs: 12
- jobs: 3
- listeners: 1

## Modules
- event-backend
- event-backend/api
- event-backend/app
- event-backend/bom
- event-backend/build
- event-backend/common
- event-backend/persistence
- event-backend/service
- event-backend/versions
- event-backend/web
- event-notification

## Architecture relationships
- api defines the contract-first HTTP surface and DTO layer
- web implements REST controllers and delegates to service
- service orchestrates business logic and depends on persistence and common
- persistence owns repositories, entities, and query logic
- common owns shared security, Redis, notification, and utility code
- app bootstraps the Spring Boot application and imports the runtime configuration
- event-notification is a separate real-time notification service with Redis and WebSocket support

## Key classes
### controllers
- event-backend/web/src/main/java/hu/event/be/web/controller/AuthApiImpl.java
- event-backend/web/src/main/java/hu/event/be/web/controller/CohostInvitationsApiImpl.java
- event-backend/web/src/main/java/hu/event/be/web/controller/EmailApiImpl.java
- event-backend/web/src/main/java/hu/event/be/web/controller/EventCollaboratorsApiImpl.java
- event-backend/web/src/main/java/hu/event/be/web/controller/EventsApiImpl.java
- event-backend/web/src/main/java/hu/event/be/web/controller/ExportApiImpl.java
- event-backend/web/src/main/java/hu/event/be/web/controller/FeedApiImpl.java
- event-backend/web/src/main/java/hu/event/be/web/controller/FeedbackApiImpl.java
- event-backend/web/src/main/java/hu/event/be/web/controller/FollowsApiImpl.java
- event-backend/web/src/main/java/hu/event/be/web/controller/InvitesApiImpl.java
- event-backend/web/src/main/java/hu/event/be/web/controller/LocationApiImpl.java
- event-backend/web/src/main/java/hu/event/be/web/controller/MediaApiImpl.java
- event-backend/web/src/main/java/hu/event/be/web/controller/OrganizerAdminsApiImpl.java
- event-backend/web/src/main/java/hu/event/be/web/controller/ProfileApiImpl.java
- event-backend/web/src/main/java/hu/event/be/web/controller/RsvpApiImpl.java
- event-backend/web/src/main/java/hu/event/be/web/controller/SearchApiImpl.java


### services
- event-backend/service/src/main/java/hu/event/be/service/services/AuthService.java
- event-backend/service/src/main/java/hu/event/be/service/services/CohostInvitationService.java
- event-backend/service/src/main/java/hu/event/be/service/services/EmailVerificationService.java
- event-backend/service/src/main/java/hu/event/be/service/services/EventAutoArchiveService.java
- event-backend/service/src/main/java/hu/event/be/service/services/EventCollaboratorService.java
- event-backend/service/src/main/java/hu/event/be/service/services/EventService.java
- event-backend/service/src/main/java/hu/event/be/service/services/ExportService.java
- event-backend/service/src/main/java/hu/event/be/service/services/FeedService.java
- event-backend/service/src/main/java/hu/event/be/service/services/FeedbackService.java
- event-backend/service/src/main/java/hu/event/be/service/services/InviteDispatchService.java
- event-backend/service/src/main/java/hu/event/be/service/services/InviteService.java
- event-backend/service/src/main/java/hu/event/be/service/services/LocationFollowService.java
- event-backend/service/src/main/java/hu/event/be/service/services/LocationService.java
- event-backend/service/src/main/java/hu/event/be/service/services/MediaService.java
- event-backend/service/src/main/java/hu/event/be/service/services/OrganizerFollowService.java
- event-backend/service/src/main/java/hu/event/be/service/services/OrganizerService.java


### repositories
- event-backend/persistence/src/main/java/hu/event/be/persistence/repository/CohostInvitationRepository.java
- event-backend/persistence/src/main/java/hu/event/be/persistence/repository/EmailVerificationTokenRepository.java
- event-backend/persistence/src/main/java/hu/event/be/persistence/repository/EventCollaboratorsRepository.java
- event-backend/persistence/src/main/java/hu/event/be/persistence/repository/EventInviteWriterRepository.java
- event-backend/persistence/src/main/java/hu/event/be/persistence/repository/EventRepository.java
- event-backend/persistence/src/main/java/hu/event/be/persistence/repository/FeedRepository.java
- event-backend/persistence/src/main/java/hu/event/be/persistence/repository/FeedbackRepository.java
- event-backend/persistence/src/main/java/hu/event/be/persistence/repository/LocationRepository.java
- event-backend/persistence/src/main/java/hu/event/be/persistence/repository/MeFollowsQueryRepository.java
- event-backend/persistence/src/main/java/hu/event/be/persistence/repository/MediaRepository.java
- event-backend/persistence/src/main/java/hu/event/be/persistence/repository/OrganizerRepository.java
- event-backend/persistence/src/main/java/hu/event/be/persistence/repository/OrganizerStatsRepository.java
- event-backend/persistence/src/main/java/hu/event/be/persistence/repository/PasswordResetTokenRepository.java
- event-backend/persistence/src/main/java/hu/event/be/persistence/repository/PopularityRepository.java
- event-backend/persistence/src/main/java/hu/event/be/persistence/repository/RefreshTokenRepository.java
- event-backend/persistence/src/main/java/hu/event/be/persistence/repository/RsvpRepository.java


### security
- event-backend/common/src/main/java/hu/event/be/common/security/AuthProps.java
- event-backend/common/src/main/java/hu/event/be/common/security/CookieOrHeaderBearerTokenResolver.java
- event-backend/common/src/main/java/hu/event/be/common/security/JwtDecoderConfig.java
- event-backend/common/src/main/java/hu/event/be/common/security/JwtIssuer.java
- event-backend/common/src/main/java/hu/event/be/common/security/JwtKeyConfig.java
- event-backend/common/src/main/java/hu/event/be/common/security/SecurityConfig.java


### policies
- event-backend/service/src/main/java/hu/event/be/service/guard/policies/AddMediaPolicy.java
- event-backend/service/src/main/java/hu/event/be/service/guard/policies/AddMoreThanNMediaPolicy.java
- event-backend/service/src/main/java/hu/event/be/service/guard/policies/AnalyticsReadPolicy.java
- event-backend/service/src/main/java/hu/event/be/service/guard/policies/ExportRsvpCsvPolicy.java
- event-backend/service/src/main/java/hu/event/be/service/guard/policies/FeaturePolicy.java


### configs
- event-backend/api/src/main/java/hu/event/be/openapi/OpenApiConfig.java
- event-backend/app/src/main/java/hu/event/be/config/MinioConfiguration.java
- event-backend/common/src/main/java/hu/event/be/common/redis/RedisPublisherConfig.java
- event-backend/common/src/main/java/hu/event/be/common/security/JwtDecoderConfig.java
- event-backend/common/src/main/java/hu/event/be/common/security/JwtKeyConfig.java
- event-backend/common/src/main/java/hu/event/be/common/security/SecurityConfig.java
- event-backend/service/src/main/java/hu/event/be/service/jobs/SchedulingConfig.java
- event-backend/web/src/main/java/hu/event/be/web/config/WebCorsConfig.java
- event-notification/src/main/java/hu/event/notification/config/OpenApiConfig.java
- event-notification/src/main/java/hu/event/notification/config/WebConfig.java
- event-notification/src/main/java/hu/event/notification/redis/RedisConfig.java
- event-notification/src/main/java/hu/event/notification/ws/WsConfig.java


### jobs
- event-backend/service/src/main/java/hu/event/be/service/jobs/EventAutoArchiveJob.java
- event-backend/service/src/main/java/hu/event/be/service/jobs/PopularityRefreshJob.java
- event-backend/service/src/main/java/hu/event/be/service/jobs/SchedulingConfig.java


### listeners
- event-backend/service/src/main/java/hu/event/be/service/listeners/StatsEventListener.java


### entities
- event-backend/persistence/src/main/java/hu/event/be/persistence/entity/EmailVerificationTokenEntity.java
- event-backend/persistence/src/main/java/hu/event/be/persistence/entity/EventInviteEntity.java
- event-backend/persistence/src/main/java/hu/event/be/persistence/entity/FeedbackEntity.java
- event-backend/persistence/src/main/java/hu/event/be/persistence/entity/PasswordResetTokenEntity.java
- event-backend/persistence/src/main/java/hu/event/be/persistence/entity/UserEntity.java


## Technologies
- cors
- datasource
- flyway
- jwt
- lombok
- mail
- minio
- openapi
- postgresql
- redis
- s3
- security
- spring
- spring-boot
- turnstile
- websocket

## Observations
- multi-module Maven architecture
- broad REST surface
- substantial service orchestration layer
- rich persistence and query layer
- JWT-based security boundary
- Redis-backed runtime integration
- schema migration pipeline
- real-time push channel
- object storage integration
- contract-first HTTP layer
