// The two email formats the legacy reader recognizes — ported REGEX-FOR-REGEX from
// Automation/src/index.js:60-101 (`extractEmailDetails`). These patterns are the business
// contract with the banks' ticketing systems; "improving" them would change which mails match.
//
// Format 1 — "machine number: 1234_0567 … ticket subject: X "issue" ticket number: …"
// Format 2 — "Managed client:BM00567 … Status code Description : issue …"
//
// Both machine captures strip leading zeros (:73, :85) — the same rule as
// `normalizeAtmMachineCode`. Format 2's checks run AFTER format 1's and overwrite its captures
// when both match, exactly as the legacy's sequential ifs did.

export interface ParsedAtmMail {
  machineCode: string | null;
  issueText: string | null;
}

export const parseAtmMailBody = (body: string): ParsedAtmMail => {
  let machineCode: string | null = null;
  let issueText: string | null = null;

  const machineMatch1 = /machine number:\s\d+_(\d+)/.exec(body);
  if (machineMatch1 !== null) {
    machineCode = (machineMatch1[1] as string).replace(/^0+/, '');
  }

  const issueMatch1 = /ticket subject:\s*\S+\s+"?([^"]+?)"?\s+ticket number:/i.exec(body);
  if (issueMatch1 !== null) {
    issueText = (issueMatch1[1] as string).trim();
  }

  const machineMatch2 = /Managed client:BM0*(\d+)/.exec(body);
  if (machineMatch2 !== null) {
    machineCode = machineMatch2[1] as string;
  }

  const issueMatch2 =
    /Status code Description\s*:\s*([\s\S]*?)(?=\s*(?:Ticket Detail|Address 1|RequestNumber)|$)/i.exec(
      body,
    );
  if (issueMatch2 !== null) {
    issueText = (issueMatch2[1] as string)
      .trim()
      .replace(/<\/?[^>]+(>|$)/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ');
  }

  // The legacy treated an empty capture as no capture ("N/A") — normalize '' to null the same way.
  return {
    machineCode: machineCode === '' ? null : machineCode,
    issueText: issueText === '' ? null : issueText,
  };
};
