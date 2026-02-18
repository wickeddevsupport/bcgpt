import { MigrationInterface, QueryRunner } from 'typeorm'

export class CreateFlowGalleryExecutionTable1769700000004 implements MigrationInterface {
    name = 'CreateFlowGalleryExecutionTable1769700000004'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "flow_gallery_run" (
                "id" character varying(21) NOT NULL,
                "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "appId" character varying NOT NULL,
                "status" character varying NOT NULL,
                "executionTimeMs" integer,
                "inputKeys" character varying array,
                "outputType" character varying,
                "error" character varying,
                "requestId" character varying,
                CONSTRAINT "PK_flow_gallery_run_id" PRIMARY KEY ("id")
            )
        `)

        await queryRunner.query(`
            CREATE INDEX "idx_flow_gallery_run_app_id_created"
            ON "flow_gallery_run" ("appId", "created")
        `)

        await queryRunner.query(`
            CREATE INDEX "idx_flow_gallery_run_status"
            ON "flow_gallery_run" ("status")
        `)
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_flow_gallery_run_status"`)
        await queryRunner.query(`DROP INDEX IF EXISTS "idx_flow_gallery_run_app_id_created"`)
        await queryRunner.query(`DROP TABLE "flow_gallery_run"`)
    }
}
