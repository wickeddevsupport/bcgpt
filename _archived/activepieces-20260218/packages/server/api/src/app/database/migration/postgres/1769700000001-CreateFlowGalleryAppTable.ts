import { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * Create Flow Gallery App Table
 * 
 * Stores gallery-specific metadata for featured templates
 * allowing templates to be published as public workflow apps
 * 
 * References: Flow Gallery Module - Public App Store
 */

export class CreateFlowGalleryAppTable1769700000001 implements MigrationInterface {
    name = 'CreateFlowGalleryAppTable1769700000001'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Create the flow_gallery_app table
        await queryRunner.query(`
            CREATE TABLE "flow_gallery_app" (
                "id" character varying(21) NOT NULL,
                "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "templateId" character varying NOT NULL,
                "platformId" character varying,
                "featured" boolean NOT NULL DEFAULT false,
                "displayOrder" integer NOT NULL DEFAULT 0,
                "description" character varying,
                "icon" character varying,
                "category" character varying,
                "tags" character varying array,
                CONSTRAINT "PK_flow_gallery_app_id" PRIMARY KEY ("id")
            )
        `)

        // Create indices for performance
        await queryRunner.query(`
            CREATE INDEX "idx_flow_gallery_app_platform_id_featured"
            ON "flow_gallery_app" ("platformId", "featured")
        `)

        await queryRunner.query(`
            CREATE INDEX "idx_flow_gallery_app_display_order"
            ON "flow_gallery_app" ("displayOrder")
        `)

        await queryRunner.query(`
            CREATE INDEX "idx_flow_gallery_app_category"
            ON "flow_gallery_app" ("category")
        `)

        // Create foreign key to platform (optional)
        await queryRunner.query(`
            ALTER TABLE "flow_gallery_app"
            ADD CONSTRAINT "fk_flow_gallery_app_platform_id"
            FOREIGN KEY ("platformId") 
            REFERENCES "platform"("id") 
            ON DELETE CASCADE 
            ON UPDATE NO ACTION
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Drop foreign key
        await queryRunner.query(`
            ALTER TABLE "flow_gallery_app"
            DROP CONSTRAINT "fk_flow_gallery_app_platform_id"
        `)

        // Drop indices
        await queryRunner.query(`
            DROP INDEX IF EXISTS "idx_flow_gallery_app_category"
        `)

        await queryRunner.query(`
            DROP INDEX IF EXISTS "idx_flow_gallery_app_display_order"
        `)

        await queryRunner.query(`
            DROP INDEX IF EXISTS "idx_flow_gallery_app_platform_id_featured"
        `)

        // Drop table
        await queryRunner.query(`
            DROP TABLE "flow_gallery_app"
        `)
    }
}
