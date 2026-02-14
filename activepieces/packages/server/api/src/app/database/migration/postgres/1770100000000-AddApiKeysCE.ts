import { MigrationInterface, QueryRunner } from 'typeorm'

export class AddApiKeysCE1770100000000 implements MigrationInterface {
    name = 'AddApiKeysCE1770100000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Check if api_key table exists
        const tableExists = await queryRunner.hasTable('api_key')
        
        if (!tableExists) {
            // Create api_key table for CE
            await queryRunner.query(`
                CREATE TABLE "api_key" (
                    "id" character varying(21) NOT NULL,
                    "created" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                    "updated" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                    "displayName" character varying NOT NULL,
                    "value" character varying NOT NULL,
                    "platformId" character varying(21),
                    "lastUsedAt" TIMESTAMP WITH TIME ZONE,
                    CONSTRAINT "PK_api_key_id" PRIMARY KEY ("id")
                )
            `)
            
            // Create unique index on value (hashed API key)
            await queryRunner.query(`
                CREATE UNIQUE INDEX "idx_api_key_value" ON "api_key" ("value")
            `)
            
            // Create index on platformId for faster lookups
            await queryRunner.query(`
                CREATE INDEX "idx_api_key_platform_id" ON "api_key" ("platformId")
            `)
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const tableExists = await queryRunner.hasTable('api_key')
        if (tableExists) {
            await queryRunner.query(`DROP INDEX IF EXISTS "idx_api_key_platform_id"`)
            await queryRunner.query(`DROP INDEX IF EXISTS "idx_api_key_value"`)
            await queryRunner.query(`DROP TABLE "api_key"`)
        }
    }
}
