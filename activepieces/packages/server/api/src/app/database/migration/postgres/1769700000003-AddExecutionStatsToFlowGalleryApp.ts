import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddExecutionStatsToFlowGalleryApp1769700000003 implements MigrationInterface {
    name = 'AddExecutionStatsToFlowGalleryApp1769700000003'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "flow_gallery_app" ADD COLUMN IF NOT EXISTS "runCount" integer NOT NULL DEFAULT 0`)
        await queryRunner.query(`ALTER TABLE "flow_gallery_app" ADD COLUMN IF NOT EXISTS "successCount" integer NOT NULL DEFAULT 0`)
        await queryRunner.query(`ALTER TABLE "flow_gallery_app" ADD COLUMN IF NOT EXISTS "failedCount" integer NOT NULL DEFAULT 0`)
        await queryRunner.query(`ALTER TABLE "flow_gallery_app" ADD COLUMN IF NOT EXISTS "averageExecutionMs" integer`)
        await queryRunner.query(`ALTER TABLE "flow_gallery_app" ADD COLUMN IF NOT EXISTS "lastExecutionAt" TIMESTAMP`)
        await queryRunner.query(`ALTER TABLE "flow_gallery_app" ADD COLUMN IF NOT EXISTS "lastError" character varying`)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "flow_gallery_app" DROP COLUMN IF EXISTS "lastError"`)
        await queryRunner.query(`ALTER TABLE "flow_gallery_app" DROP COLUMN IF EXISTS "lastExecutionAt"`)
        await queryRunner.query(`ALTER TABLE "flow_gallery_app" DROP COLUMN IF EXISTS "averageExecutionMs"`)
        await queryRunner.query(`ALTER TABLE "flow_gallery_app" DROP COLUMN IF EXISTS "failedCount"`)
        await queryRunner.query(`ALTER TABLE "flow_gallery_app" DROP COLUMN IF EXISTS "successCount"`)
        await queryRunner.query(`ALTER TABLE "flow_gallery_app" DROP COLUMN IF EXISTS "runCount"`)
    }
}
