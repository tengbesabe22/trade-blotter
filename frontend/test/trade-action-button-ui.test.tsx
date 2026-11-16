import assert from 'node:assert/strict';
import test, { after, afterEach } from 'node:test';
import { JSDOM } from 'jsdom';
import { TradeActionButton } from '../src/trades/components/TradeActionButton';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost:5173' });
Object.defineProperties(globalThis, {
  window: { configurable: true, value: dom.window },
  document: { configurable: true, value: dom.window.document },
  navigator: { configurable: true, value: dom.window.navigator },
  HTMLElement: { configurable: true, value: dom.window.HTMLElement },
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, writable: true, value: true },
});
const { render, screen, fireEvent, act, cleanup } = await import('@testing-library/react');
afterEach(() => cleanup());
after(() => dom.window.close());

for (const action of ['amend', 'cancel', 'history'] as const) {
  test(`${action} uses an icon with an accessible name and a hover/focus tooltip`, () => {
    const label = `${action} AAPL trade trade-1`;
    render(<TradeActionButton action={action} label={label} disabled={false} onClick={() => {}} />);
    const button = screen.getByRole('button', { name: label });
    assert.equal(button.textContent, '');
    assert.equal(button.querySelector('svg')?.getAttribute('aria-hidden'), 'true');
    assert.equal(screen.queryByRole('tooltip') === null, true);
    fireEvent.mouseEnter(button);
    assert.equal(screen.getByRole('tooltip').textContent, action === 'amend' ? 'Amend trade' : action === 'cancel' ? 'Cancel trade' : 'Trade history');
    assert.equal(button.getAttribute('aria-describedby'), screen.getByRole('tooltip').id);
    fireEvent.mouseLeave(button);
    assert.equal(screen.queryByRole('tooltip') === null, true);
    act(() => button.focus());
    assert.ok(screen.getByRole('tooltip'));
    fireEvent.keyDown(document, { key: 'Escape' });
    assert.equal(screen.queryByRole('tooltip') === null, true);
    assert.equal(document.activeElement === button, true);
  });
}

test('disabled actions cannot submit or display a tooltip', () => {
  let clicks = 0;
  render(<TradeActionButton action="cancel" label="Cancel AAPL trade trade-1" disabled onClick={() => { clicks += 1; }} />);
  const button = screen.getByRole('button');
  fireEvent.mouseEnter(button);
  fireEvent.click(button);
  assert.equal(clicks, 0);
  assert.equal(screen.queryByRole('tooltip') === null, true);
});

test('activation dismisses the tooltip and runs the existing action; unmount removes its portal', () => {
  let clicks = 0;
  const view = render(<TradeActionButton action="amend" label="Amend AAPL trade trade-1" disabled={false} onClick={() => { clicks += 1; }} />);
  const button = screen.getByRole('button');
  fireEvent.mouseEnter(button);
  assert.ok(screen.getByRole('tooltip'));
  fireEvent.click(button);
  assert.equal(clicks, 1);
  assert.equal(screen.queryByRole('tooltip') === null, true);
  fireEvent.mouseEnter(button);
  assert.ok(screen.getByRole('tooltip'));
  view.unmount();
  assert.equal(screen.queryByRole('tooltip') === null, true);
});

test('viewport movement preserves a focused tooltip but dismisses a hover-only tooltip', () => {
  render(<TradeActionButton action="amend" label="Amend AAPL trade trade-1" disabled={false} onClick={() => {}} />);
  const button = screen.getByRole('button');
  act(() => button.focus());
  fireEvent.scroll(document);
  assert.equal(screen.queryByRole('tooltip') !== null, true);
  act(() => button.blur());
  fireEvent.mouseEnter(button);
  assert.ok(screen.getByRole('tooltip'));
  fireEvent.scroll(document);
  assert.equal(screen.queryByRole('tooltip') === null, true);
});


test('the pointer can cross onto the tooltip, then leaving dismisses it immediately', () => {
  render(<TradeActionButton action="amend" label="Amend AAPL trade trade-1" disabled={false} onClick={() => {}} />);
  const button = screen.getByRole('button');
  fireEvent.mouseEnter(button);
  const tooltip = screen.getByRole('tooltip');
  fireEvent.mouseLeave(button, { relatedTarget: tooltip });
  assert.equal(screen.queryByRole('tooltip') !== null, true);
  fireEvent.mouseLeave(tooltip, { relatedTarget: document.body });
  assert.equal(screen.queryByRole('tooltip') === null, true);
});
