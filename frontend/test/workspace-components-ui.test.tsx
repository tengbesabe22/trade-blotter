import assert from 'node:assert/strict';
import test, { after, afterEach } from 'node:test';
import { createRef, useState } from 'react';
import { JSDOM } from 'jsdom';
import { WorkspaceTabs, type WorkspaceTab } from '../src/trades/components/WorkspaceTabs';
import { TradeListHeader } from '../src/trades/components/TradeListHeader';

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

function Tabs() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('trades');
  return <WorkspaceTabs activeTab={activeTab} onSelect={setActiveTab} />;
}

test('workspace tabs expose the active view and switch through pointer activation', () => {
  render(<Tabs />);
  const trades = screen.getByRole('tab', { name: 'Trades' });
  const positions = screen.getByRole('tab', { name: 'Position Summary' });

  assert.equal(trades.getAttribute('aria-selected'), 'true');
  assert.equal(trades.getAttribute('aria-controls'), 'trades-panel');
  assert.equal(positions.getAttribute('aria-controls'), 'positions-panel');
  assert.equal(trades.tabIndex, 0);
  assert.equal(positions.tabIndex, -1);

  fireEvent.click(positions);

  assert.equal(positions.getAttribute('aria-selected'), 'true');
  assert.equal(positions.tabIndex, 0);
  assert.equal(trades.tabIndex, -1);
});

test('arrow, Home and End keys move both selection and focus between workspace tabs', () => {
  render(<Tabs />);
  const tabs = screen.getByRole('tablist', { name: 'Workspace views' });
  const trades = screen.getByRole('tab', { name: 'Trades' });
  const positions = screen.getByRole('tab', { name: 'Position Summary' });

  for (const [key, selected] of [
    ['ArrowRight', positions], ['ArrowLeft', trades], ['End', positions], ['Home', trades],
  ] as const) {
    fireEvent.keyDown(tabs, { key });
    assert.equal(selected.getAttribute('aria-selected'), 'true');
    assert.equal(document.activeElement, selected);
  }

  fireEvent.keyDown(tabs, { key: 'Escape' });
  assert.equal(trades.getAttribute('aria-selected'), 'true');
});

test('the trade header displays exact counts and forwards the refresh action', () => {
  let refreshes = 0;
  const title = createRef<HTMLHeadingElement>();
  const props = { isFetching: false, sessionExpired: false, titleRef: title,
    onRefresh: () => { refreshes += 1; } };
  const view = render(<TradeListHeader {...props} tradeCount={0} />);

  assert.ok(screen.getByText('0 trades shown'));
  assert.equal(title.current, screen.getByRole('heading', { name: 'Trades' }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh trades' }));
  assert.equal(refreshes, 1);

  view.rerender(<TradeListHeader {...props} tradeCount={1} />);
  assert.ok(screen.getByText('1 trade shown'));
  view.rerender(<TradeListHeader {...props} tradeCount={100} />);
  assert.ok(screen.getByText('100 trades shown'));
});

test('a pending refresh keeps its count visible and prevents another refresh', () => {
  let refreshes = 0;
  render(<TradeListHeader tradeCount={100} isFetching sessionExpired={false}
    onRefresh={() => { refreshes += 1; }} />);
  const button = screen.getByRole('button', { name: 'Refreshing…' });

  assert.ok(screen.getByText('100 trades shown'));
  assert.equal(button.hasAttribute('disabled'), true);
  fireEvent.click(button);
  assert.equal(refreshes, 0);
});

test('the header keeps its loading context and hides refresh when the session expires', () => {
  const props = { isFetching: true, sessionExpired: false, onRefresh: () => {} };
  const view = render(<TradeListHeader {...props} />);

  assert.ok(screen.getByText('USD equities · All traders'));
  assert.equal(screen.getByRole('button', { name: 'Refresh trades' }).hasAttribute('disabled'), true);

  view.rerender(<TradeListHeader {...props} tradeCount={100} sessionExpired />);
  assert.ok(screen.getByText('USD equities · All traders'));
  assert.equal(screen.queryByRole('button', { name: /Refresh/ }), null);
});
