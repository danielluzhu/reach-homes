/**
 * Tenants' contact details, copied from the rosters the admin hands over
 * (5612's, so far) into data/contacts.json, which is gitignored: these are
 * real people's names, emails and phones.
 *
 * Who sees them is decided here, the same way as the payments: the admin and
 * the team see every one; an owner sees a tenant only when the building
 * resolves on the registry to exactly one owner and that owner is them. The
 * roster's own working notes ("missing from the export") stay with the admin
 * and team.
 */

import { file } from "bun";
import { resolveOwner, type Registry, type Viewer } from "./payments";

const CONTACTS_PATH = `${import.meta.dir}/data/contacts.json`;

export type Contact = {
  building: string; // the registry's abbreviation, e.g. "5612B"
  unit: string;
  name: string;
  status: string; // "Current", "Future"
  type: string; // "Financially Responsible", "Co-signer"
  emails: string[];
  phones: string[];
  leaseStart: string;
  leaseEnd: string;
  note: string;
};

async function loadContacts(): Promise<Contact[]> {
  const f = file(CONTACTS_PATH);
  return (await f.exists()) ? ((await f.json()).tenants ?? []) : [];
}

/** What this viewer may see, with the building's street address for display. */
export async function contactsFor(viewer: Viewer, registry: Registry) {
  const all = await loadContacts();
  const withAddress = (c: Contact) => {
    const place = registry.places[c.building.match(/^\d+/)?.[0] ?? ""];
    return { ...c, address: place ? `${place.street} ${c.building.replace(/^\d+/, "")}`.trim() : c.building };
  };
  if (viewer.kind !== "owner") return all.map(withAddress);
  return all
    .filter((c) => resolveOwner(c.building, "", registry.rows)?.owner === viewer.name)
    .map((c) => withAddress({ ...c, note: "" }));
}
