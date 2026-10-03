/**
 * Builds small PDFs for tests: positioned text (one BT…ET per piece, in the order given, so content-stream order can
 * differ from visual order the way printed spreadsheets do) and AcroForm widgets (text fields, checkboxes, radio
 * groups) shaped like the official fillable CDS form's. Not a test file itself (no `.test.`).
 */

export interface TinyText {
  x: number;
  y: number;
  s: string;
}

export type TinyWidget =
  | { kind: "text"; name: string; value: string; x: number; y: number }
  | { kind: "check"; name: string; on: boolean; x: number; y: number }
  | { kind: "radio"; name: string; options: string[]; value: string | null; x: number; y: number };

export interface TinyPage {
  text: TinyText[];
  widgets?: TinyWidget[];
}

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const pdfName = (s: string) => `/${s.replace(/[^A-Za-z0-9_.-]/g, (c) => `#${c.charCodeAt(0).toString(16).padStart(2, "0")}`)}`;

/** A one-or-more page PDF with Helvetica text and optional form widgets. */
export function tinyPdf(pages: TinyPage[]): Uint8Array {
  const objs: string[] = []; // objs[i] is object i + 1
  const add = (body: string) => objs.push(body);
  const reserve = () => objs.push("") ;
  reserve(); // 1 catalog
  reserve(); // 2 pages
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"); // 3
  add("<< /Type /XObject /Subtype /Form /BBox [0 0 10 10] /Length 0 >>\nstream\n\nendstream"); // 4 appearance
  const ap = (on: string) => `/AP << /N << ${pdfName(on)} 4 0 R /Off 4 0 R >> >>`;
  const fields: number[] = [];
  const pageRefs: number[] = [];
  for (const page of pages) {
    const content = page.text.map((t) => `BT /F1 9 Tf ${t.x} ${t.y} Td (${esc(t.s)}) Tj ET`).join("\n");
    add(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
    const contentRef = objs.length;
    reserve();
    const pageRef = objs.length;
    const annots: number[] = [];
    for (const w of page.widgets ?? []) {
      const rect = (dx = 0) => `/Rect [${w.x + dx} ${w.y} ${w.x + dx + 10} ${w.y + 10}]`;
      if (w.kind === "text") {
        add(`<< /Type /Annot /Subtype /Widget /FT /Tx /T (${esc(w.name)}) /V (${esc(w.value)}) ${rect()} /P ${pageRef} 0 R >>`);
        annots.push(objs.length);
        fields.push(objs.length);
      } else if (w.kind === "check") {
        const state = w.on ? "/X" : "/Off";
        add(`<< /Type /Annot /Subtype /Widget /FT /Btn /T (${esc(w.name)}) /V ${state} /AS ${state} ${ap("X")} ${rect()} /P ${pageRef} 0 R >>`);
        annots.push(objs.length);
        fields.push(objs.length);
      } else {
        reserve();
        const parent = objs.length;
        const kids: number[] = [];
        w.options.forEach((opt, i) => {
          const state = w.value === opt ? pdfName(opt) : "/Off";
          add(`<< /Type /Annot /Subtype /Widget /Parent ${parent} 0 R /AS ${state} ${ap(opt)} ${rect(i * 20)} /P ${pageRef} 0 R >>`);
          kids.push(objs.length);
          annots.push(objs.length);
        });
        objs[parent - 1] = `<< /FT /Btn /Ff 49152 /T (${esc(w.name)}) ${w.value ? `/V ${pdfName(w.value)}` : ""} /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] >>`;
        fields.push(parent);
      }
    }
    objs[pageRef - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentRef} 0 R` +
      (annots.length ? ` /Annots [${annots.map((a) => `${a} 0 R`).join(" ")}]` : "") +
      " >>";
    pageRefs.push(pageRef);
  }
  objs[0] = `<< /Type /Catalog /Pages 2 0 R${fields.length ? ` /AcroForm << /Fields [${fields.map((f) => `${f} 0 R`).join(" ")}] >>` : ""} >>`;
  objs[1] = `<< /Type /Pages /Kids [${pageRefs.map((p) => `${p} 0 R`).join(" ")}] /Count ${pageRefs.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}
