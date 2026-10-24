/**
 * Signed leases and their addenda, as PDFs filed by building and unit under
 * data/leases/ (gitignored): "4544/201/Lease 4544 201 26 Melanie.pdf", or
 * straight under the building when the document names no unit.
 *
 * Who sees one is decided here, the same way as the payments: the admin sees
 * every file; an owner sees a file only when its building (and unit) resolves
 * on the registry to exactly one owner and that owner is them. A building
 * with several owners (121) shows its unit folders to each unit's owner and
 * its own files to nobody but the admin. The team doesn't see leases.
 */

import { file } from "bun";
import { readdir } from "node:fs/promises";
import { resolveOwner, TERM, type Registry, type Viewer } from "./payments";

const LEASES_DIR = `${import.meta.dir}/data/leases`;

export type LeaseFile = {
  building: string; // the folder: a house number, with its part where it has one ("4316L")
  unit: string; // "" for a document filed under the building
  name: string;
  path: string; // relative to data/leases, as served under /api/leases/
  address: string; // the building's street address from the registry, else the folder
};

async function listAll(registry: Registry): Promise<LeaseFile[]> {
  const out: LeaseFile[] = [];
  const entries = await readdir(LEASES_DIR, { recursive: true, withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isFile() || !e.name.toLowerCase().endsWith(".pdf")) continue;
    const rel = `${e.parentPath}/${e.name}`.slice(LEASES_DIR.length + 1);
    const [building, ...rest] = rel.split("/");
    if (!rest.length || rest.length > 2) continue;
    const place = registry.places[building.match(/^\d+/)?.[0] ?? ""];
    out.push({
      building,
      unit: rest.length === 2 ? rest[0] : "",
      name: e.name,
      path: rel,
      address: place ? `${place.street}${building.replace(/^\d+/, "") ? " " + building.replace(/^\d+/, "") : ""}` : building,
    });
  }
  return out.sort((a, b) =>
    a.building.localeCompare(b.building, undefined, { numeric: true }) ||
    a.unit.localeCompare(b.unit, undefined, { numeric: true }) || a.name.localeCompare(b.name));
}

/** The lease documents this viewer may open. */
export async function leaseFilesFor(viewer: Viewer, registry: Registry): Promise<LeaseFile[]> {
  if (viewer.kind === "team") return [];
  const all = await listAll(registry);
  if (viewer.kind === "admin") return all;
  return all.filter((f) => resolveOwner(f.building, f.unit.replace(/^#/, ""), registry.rows)?.owner === viewer.name);
}

/**
 * One document, when it is on this viewer's list -- matched against the list
 * itself, so a path can never reach outside it -- else null.
 */
export async function leaseFileResponse(viewer: Viewer, registry: Registry, path: string) {
  const hit = (await leaseFilesFor(viewer, registry)).find((f) => f.path === path);
  if (!hit) return null;
  return new Response(file(`${LEASES_DIR}/${hit.path}`), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(hit.name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * A signed lease's own name says who and for how long: "Lease 4544 102 27
 * Zoe" is unit 102, term code 27, tenant Zoe. Addenda, extensions and unit
 * changes ("Lease Extension ...", "Lease Unit Change ...") are not leases
 * and give null, as does a name with no term code.
 */
export function signedLeaseOf(f: LeaseFile) {
  const m = f.name.match(/^Lease (\d.*)\.pdf$/i);
  if (!m) return null;
  const tokens = m[1].trim().split(/\s+/);
  const at = tokens.findIndex((t, i) => i > 0 && TERM.test(t));
  if (at < 0) return null;
  return { code: tokens[at], tenant: tokens.slice(at + 1).join(" "), file: f.path };
}
