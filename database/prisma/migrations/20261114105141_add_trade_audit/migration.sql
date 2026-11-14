BEGIN;

-- CreateEnum
CREATE TYPE "TradeAuditAction" AS ENUM ('CREATED', 'AMENDED', 'CANCELLED');

-- CreateTable
CREATE TABLE "TradeAudit" (
    "id" UUID NOT NULL,
    "tradeId" UUID NOT NULL,
    "tradeVersion" INTEGER NOT NULL,
    "action" "TradeAuditAction" NOT NULL,
    "actorId" UUID NOT NULL,
    "reason" VARCHAR(500),
    "snapshot" JSONB NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TradeAudit_tradeId_tradeVersion_key" ON "TradeAudit"("tradeId", "tradeVersion");

-- AddForeignKey
ALTER TABLE "TradeAudit" ADD CONSTRAINT "TradeAudit_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "TradeAudit" ADD CONSTRAINT "TradeAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Creation starts at version 1; later actions must advance the version.
ALTER TABLE "TradeAudit"
ADD CONSTRAINT "TradeAudit_version_check"
CHECK (("action" = 'CREATED' AND "tradeVersion" = 1 AND "reason" IS NULL) OR
       ("action" IN ('AMENDED', 'CANCELLED') AND "tradeVersion" > 1)),
-- IS TRUE rejects missing JSON keys as well as incorrect values.
ADD CONSTRAINT "TradeAudit_snapshot_check"
CHECK ((jsonb_typeof("snapshot") = 'object' AND
        "snapshot" ->> 'id' = "tradeId"::text AND
        "snapshot" -> 'version' = to_jsonb("tradeVersion")) IS TRUE);

CREATE FUNCTION "reject_trade_audit_changes"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'TradeAudit is append-only; % is not permitted.', TG_OP;
END;
$$;

-- Statement-level also blocks empty UPDATE/DELETE statements and TRUNCATE CASCADE.
CREATE TRIGGER "TradeAudit_append_only"
BEFORE UPDATE OR DELETE OR TRUNCATE ON "TradeAudit"
FOR EACH STATEMENT EXECUTE FUNCTION "reject_trade_audit_changes"();

COMMIT;
