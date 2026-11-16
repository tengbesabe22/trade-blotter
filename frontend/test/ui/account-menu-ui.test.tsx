import assert from 'node:assert/strict';
import test, { after, afterEach } from 'node:test';
import { JSDOM } from 'jsdom';
import { AccountMenu } from '../../src/auth/AccountMenu';
import { signedInTrader } from '../fixtures/trade-fixtures';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:5173' });
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, writable: true, value: true },
});
const { render, screen, fireEvent, cleanup } = await import('@testing-library/react');
afterEach(() => cleanup());
after(() => dom.window.close());

function showAccount() {
  render(<AccountMenu user={{ ...signedInTrader, role: 'TRADER' }} onSignedOut={() => {}} />);
  return screen.getByRole('button', { name: 'Account for JSMITH' });
}

test('the account button toggles a dropdown containing identity, role and Sign out', () => {
  const trigger = showAccount();
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(screen.queryByRole('button', { name: 'Sign out' }) === null, true);
  fireEvent.click(trigger);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.ok(screen.getByText('JSMITH'));
  assert.ok(screen.getByText('Trader'));
  assert.ok(screen.getByRole('button', { name: 'Sign out' }));
  fireEvent.click(trigger);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});

test('Escape closes the dropdown and returns focus to the account button', () => {
  const trigger = showAccount();
  fireEvent.click(trigger);
  screen.getByRole('button', { name: 'Sign out' }).focus();
  fireEvent.keyDown(document, { key: 'Escape' });
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement === trigger, true);
});

test('a pointer outside closes the dropdown while an inside interaction keeps it open', () => {
  const trigger = showAccount();
  fireEvent.click(trigger);
  fireEvent.pointerDown(screen.getByText('JSMITH'));
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  fireEvent.pointerDown(document.body);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
});
