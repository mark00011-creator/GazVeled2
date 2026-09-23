import {
  buildSzamlazzInvoiceXml,
  parseSzamlazzXmlResponse,
  type SzamlazzInvoiceInput,
  type SzamlazzAgentResult,
} from "./xml";

const SZAMLAZZ_URL = "https://www.szamlazz.hu/szamla/";

/**
 * Számla Agent HTTP hívás (csak szerveren).
 * multipart/form-data: action-xmlagentxmlfile = XML fájl
 */
export async function callSzamlazzCreateInvoice(
  input: SzamlazzInvoiceInput,
): Promise<SzamlazzAgentResult> {
  const xml = buildSzamlazzInvoiceXml(input);
  const form = new FormData();
  form.append(
    "action-xmlagentxmlfile",
    new Blob([xml], { type: "text/xml; charset=UTF-8" }),
    "szamla.xml",
  );

  const res = await fetch(SZAMLAZZ_URL, {
    method: "POST",
    body: form,
    // Cookie jar: Edge/Node fetch nem tart fenn sessiont automatikusan több hívás között;
    // egyedi create hívásnál ez elegendő.
  });

  const contentType = res.headers.get("content-type") ?? "";
  let body: string;
  if (contentType.includes("pdf") || contentType.includes("octet-stream")) {
    const buf = Buffer.from(await res.arrayBuffer());
    // PDF bináris – base64-ként adjuk vissza a parse rétegnek szöveges jelzővel
    body = `data:application/pdf;base64,${buf.toString("base64")}`;
    if (res.ok) {
      return {
        ok: true,
        invoiceNumber: res.headers.get("szlahu_szamlaszam"),
        netTotal: null,
        grossTotal: null,
        pdfBase64: buf.toString("base64"),
        raw: body,
      };
    }
  } else {
    body = await res.text();
  }

  if (!res.ok && !body.includes("<sikeres>") && !body.includes("xmlagentresponse")) {
    return {
      ok: false,
      errorCode: String(res.status),
      errorMessage: `HTTP ${res.status}: ${body.slice(0, 300)}`,
      raw: body,
    };
  }

  // Header-ekből is jöhet számlaszám (régi válasz mód)
  const parsed = parseSzamlazzXmlResponse(body);
  if (parsed.ok && !parsed.invoiceNumber) {
    const fromHeader = res.headers.get("szlahu_szamlaszam");
    if (fromHeader) parsed.invoiceNumber = fromHeader;
  }
  return parsed;
}
