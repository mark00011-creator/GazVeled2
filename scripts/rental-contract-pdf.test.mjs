import test from "node:test";
import assert from "node:assert/strict";
import { generateRentalContractPdf } from "../src/lib/rental-contract-pdf.ts";

test("generateRentalContractPdf succeeds with partner and long line labels", async () => {
  const bytes = await generateRentalContractPdf({
    rentalId: "11111111-2222-4333-8444-555555555555",
    contractNumber: "2026/B-TEST",
    rentalType: "monthly",
    partner: {
      name: "Teszt Partner",
      company_name:
        "Hosszú Cégnév Korlátolt Felelősségű Társaság Ékezetekkel: ÁÉÍÓÖŐÚÜŰ",
      address: "1234 Budapest, Teszt utca 1.",
      tax_number: "12345678-1-23",
    },
    startDate: "2026-01-15",
    monthlyFee: 3000,
    deposit: 0,
    lines: [
      {
        palackTipus: "Cserepalack",
        gaz: "Propán-bután keverék nagyon hosszú név",
        meret: "11.5 kg",
        gyarto: "SIAD",
        tulajdonos: "Sajat",
        vonalkodAzonosito: "ABC123456789",
        nyomasProba: "2028",
        lejarat: "2027-01-15",
        potlasiErtek: 100000,
      },
    ],
  });

  assert.ok(bytes.byteLength > 1000, "PDF should have content");
  assert.equal(bytes[0], 0x25); // %
  assert.equal(bytes[1], 0x50); // P
  assert.equal(bytes[2], 0x44); // D
  assert.equal(bytes[3], 0x46); // F
});

test("generateRentalContractPdf yearly fee path also works", async () => {
  const bytes = await generateRentalContractPdf({
    rentalId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    rentalType: "yearly",
    partner: { name: "Éves Partner" },
    startDate: "2026-08-20",
    monthlyFee: 1000,
    deposit: 0,
    lines: [],
  });
  assert.ok(bytes.byteLength > 500);
});
