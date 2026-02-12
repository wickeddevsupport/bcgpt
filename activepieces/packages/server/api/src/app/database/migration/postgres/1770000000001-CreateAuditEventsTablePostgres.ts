import { MigrationInterface, QueryRunner } from 'typeorm'
import { system } from '../../../helper/system/system'

const log = system.globalLogger()

export class CreateAuditEventsTablePostgres1770000000001 implements MigrationInterface {
    name = 'CreateAuditEventsTablePostgres1770000000001'

    public async up(queryRunner: QueryRunner): Promise<void> {
        log.info('Running migration CreateAuditEventsTablePostgres1770000000001')

        await queryRunner.query(`
            CREATE TABLE "audit_events" (
                "id" character varying(21) NOT NULL,
                "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "platformId" character varying(21),
                "appId" character varying(21),
                "userId" character varying(21),
                "eventType" character varying NOT NULL CHECK ("eventType" IN ('publish', 'update', 'unpublish', 'execute', 'seed')),
                "status" character varying NOT NULL CHECK ("status" IN ('success', 'failed')),
                "ipAddress" character varying,
                "userAgent" text,
                "eventMetadata" jsonb DEFAULT '{}',
                "errorMessage" text,
                CONSTRAINT "PK_audit_events_id" PRIMARY KEY ("id")
            )
        `)

        // Create indices for common queries
        await queryRunner.query(`
            CREATE INDEX "idx_audit_events_platform_created" ON "audit_events" ("platformId", "created" DESC)
        `)

        await queryRunner.query(`
            CREATE INDEX "idx_audit_events_app_created" ON "audit_events" ("appId", "created" DESC)
        `)

        await queryRunner.query(`
            CREATE INDEX "idx_audit_events_user_created" ON "audit_events" ("userId", "created" DESC)
        `)

        await queryRunner.query(`
            CREATE INDEX "idx_audit_events_type" ON "audit_events" ("eventType")
        `)

        await queryRunner.query(`
            CREATE INDEX "idx_audit_events_status" ON "audit_events" ("status")
        `)

        log.info('Finished migration CreateAuditEventsTablePostgres1770000000001')
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        log.info('Rolling back migration CreateAuditEventsTablePostgres1770000000001')

        await queryRunner.query(`DROP INDEX IF EXISTS "idx_audit_events_status"`)
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_audit_events_type"`)
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_audit_events_user_created"`)
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_audit_events_app_created"`)
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_audit_events_platform_created"`)
        await queryRunner.query(`DROP TABLE IF EXISTS "audit_events"`)

        log.info('Finished rollback of migration CreateAuditEventsTablePostgres1770000000001')
    }
}
