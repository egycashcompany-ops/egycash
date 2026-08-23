import { describe, expect, it } from 'vitest';
import { parseAtmMailBody } from './parse-mail';

// Fixtures shaped after the two formats the legacy regexes were written against
// (Automation/src/index.js:71-97). The assertions pin capture behaviour, not prose.

describe('parseAtmMailBody — format 1 (ticket subject)', () => {
  const body =
    'Dear team, machine number: 12_00345 is down. ' +
    'ticket subject: INC "cash dispenser jammed" ticket number: 998877.';

  it('extracts the machine code with leading zeros stripped', () => {
    expect(parseAtmMailBody(body).machineCode).toBe('345');
  });

  it('extracts the quoted ticket issue', () => {
    expect(parseAtmMailBody(body).issueText).toBe('cash dispenser jammed');
  });
});

describe('parseAtmMailBody — format 2 (Managed client)', () => {
  const body =
    'Managed client:BM000672 alert. Status code Description : <b>Receipt&nbsp;printer   error</b> Ticket Detail follows';

  it('extracts the BM machine code with zeros stripped', () => {
    expect(parseAtmMailBody(body).machineCode).toBe('672');
  });

  it('cleans tags, entities and whitespace from the issue', () => {
    expect(parseAtmMailBody(body).issueText).toBe('Receipt printer error');
  });
});

describe('parseAtmMailBody — precedence and misses', () => {
  it('format 2 overwrites format 1 when both match — the legacy sequential-if order', () => {
    const body =
      'machine number: 1_002 x ticket subject: A "first issue" ticket number: 1 ' +
      'Managed client:BM009 Status code Description : second issue';
    const parsed = parseAtmMailBody(body);
    expect(parsed.machineCode).toBe('9');
    expect(parsed.issueText).toBe('second issue');
  });

  it('returns nulls when nothing matches', () => {
    expect(parseAtmMailBody('unrelated newsletter')).toEqual({
      machineCode: null,
      issueText: null,
    });
  });
});
