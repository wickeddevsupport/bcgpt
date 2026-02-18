import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddPublisherFieldsToFlowGalleryApp1769700000002 implements MigrationInterface {
    name = 'AddPublisherFieldsToFlowGalleryApp1769700000002'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "flow_gallery_app" ADD COLUMN IF NOT EXISTS "flowId" character varying`)
        await queryRunner.query(`ALTER TABLE "flow_gallery_app" ADD COLUMN IF NOT EXISTS "inputSchema" jsonb`)
        await queryRunner.query(`ALTER TABLE "flow_gallery_app" ADD COLUMN IF NOT EXISTS "outputType" character varying`)
        await queryRunner.query(`ALTER TABLE "flow_gallery_app" ADD COLUMN IF NOT EXISTS "outputSchema" jsonb`)
        await queryRunner.query(`ALTER TABLE "flow_gallery_app" ADD COLUMN IF NOT EXISTS "publishedBy" character varying`)

        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "ux_flow_gallery_app_template_platform"
            ON "flow_gallery_app" ("templateId", "platformId")
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "ux_flow_gallery_app_template_platform"`)
        await queryRunner.query(`ALTER TABLE "flow_gallery_app" DROP COLUMN IF EXISTS "publishedBy"`)
        await queryRunner.query(`ALTER TABLE "flow_gallery_app" DROP COLUMN IF EXISTS "outputSchema"`)
        await queryRunner.query(`ALTER TABLE "flow_gallery_app" DROP COLUMN IF EXISTS "outputType"`)
        await queryRunner.query(`ALTER TABLE "flow_gallery_app" DROP COLUMN IF EXISTS "inputSchema"`)
        await queryRunner.query(`ALTER TABLE "flow_gallery_app" DROP COLUMN IF EXISTS "flowId"`)
    }
}
