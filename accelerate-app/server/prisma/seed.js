// Fake brand-master data — stand-in for a real TactPlan/MDS feed. Drives the
// New Campaign Request modal's Brand/Indication search-and-autofill and the
// Asset Scope inference (server/server.js GET /api/brand-lookup).
const { PrismaClient } = require('../generated/prisma');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || 'file:./dev.db' });
const prisma = new PrismaClient({ adapter });

const ROWS = [
  { brand: 'Kisqali', indication: 'HR+/HER2− early breast cancer', brandedUnbranded: 'Branded' },
  { brand: 'Kisqali', indication: 'HR+/HER2− metastatic breast cancer', brandedUnbranded: 'Branded' },
  { brand: 'Cosentyx', indication: 'Plaque psoriasis', brandedUnbranded: 'Branded' },
  { brand: 'Cosentyx', indication: 'Psoriatic arthritis', brandedUnbranded: 'Branded' },
  { brand: 'Entresto', indication: 'Heart failure with preserved ejection fraction (HFpEF)', brandedUnbranded: 'Branded' },
  { brand: 'Leqvio', indication: 'Hyperlipidemia / LDL-C reduction', brandedUnbranded: 'Branded' },
  { brand: 'Pluvicto', indication: 'PSMA-positive metastatic castration-resistant prostate cancer', brandedUnbranded: 'Branded' },
  { brand: 'Scemblix', indication: 'Chronic myeloid leukemia (CML)', brandedUnbranded: 'Branded' },
  { brand: 'Kesimpta', indication: 'Relapsing multiple sclerosis', brandedUnbranded: 'Branded' },
];

async function main() {
  for (const row of ROWS) {
    await prisma.brandIndication.upsert({
      where: { brand_indication: { brand: row.brand, indication: row.indication } },
      update: row,
      create: row,
    });
  }
  console.log(`Seeded ${ROWS.length} brand/indication rows.`);
}

main().finally(() => prisma.$disconnect());
