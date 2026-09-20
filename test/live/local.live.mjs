import test from 'node:test';
import assert from 'node:assert/strict';
import { SessionStore } from '../../dist/domain/sessions.js';
import { startBrowsing } from '../../dist/start_browsing.js';
import { JevDecider } from '../../dist/jev/client.js';
import { startSite, withRoot } from '../helpers.mjs';

const key = process.env.TYPESAFE_API_KEY ?? process.env.JEV_API_KEY;

test('the real model reaches the contact page and quotes the phone number', { skip: key ? false : 'no API key' }, async () => {
  const site = await startSite();
  try {
    const report = await withRoot(async root => {
      const store = new SessionStore(root);
      try {
        return await startBrowsing(store, new JevDecider(), {
          url: site.url,
          goal: 'Find the workshop telephone number of this company.',
          questions: [{ key: 'phone', question: 'What is the workshop telephone number?' }],
          maxSteps: 8,
          maxMessages: 20,
        }, AbortSignal.timeout(170000));
      } finally { await store.shutdown(); }
    });
    assert.equal(report.status, 'answered', report.need);
    assert.match(report.findings[0].answer, /5555 1234/);
  } finally { await site.stop(); }
});
