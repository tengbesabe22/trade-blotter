BEGIN;

-- CreateTable
CREATE TABLE "SymbolSummary" (
    "id" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "buyQuantity" DECIMAL(28,6) NOT NULL DEFAULT 0,
    "sellQuantity" DECIMAL(28,6) NOT NULL DEFAULT 0,
    "buyValue" DECIMAL(38,10) NOT NULL DEFAULT 0,
    "sellValue" DECIMAL(38,10) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SymbolSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SymbolSummary_instrumentId_key" ON "SymbolSummary"("instrumentId");

-- AddForeignKey
ALTER TABLE "SymbolSummary" ADD CONSTRAINT "SymbolSummary_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Totals can reach zero; negative deltas must never make stored totals negative.
-- PostgreSQL permits numeric NaN, so reject it explicitly as well.
ALTER TABLE "SymbolSummary"
ADD CONSTRAINT "SymbolSummary_buyQuantity_check"
CHECK ("buyQuantity" >= 0 AND "buyQuantity" <> 'NaN'::numeric),
ADD CONSTRAINT "SymbolSummary_sellQuantity_check"
CHECK ("sellQuantity" >= 0 AND "sellQuantity" <> 'NaN'::numeric),
ADD CONSTRAINT "SymbolSummary_buyValue_check"
CHECK ("buyValue" >= 0 AND "buyValue" <> 'NaN'::numeric),
ADD CONSTRAINT "SymbolSummary_sellValue_check"
CHECK ("sellValue" >= 0 AND "sellValue" <> 'NaN'::numeric),
ADD CONSTRAINT "SymbolSummary_version_check"
CHECK ("version" >= 0);

COMMIT;
