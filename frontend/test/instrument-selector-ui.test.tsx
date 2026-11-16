import assert from 'node:assert/strict';
import test, { after, afterEach } from 'node:test';
import { useState } from 'react';
import { JSDOM } from 'jsdom';
import { InstrumentSelector } from '../src/trades/components/InstrumentSelector';

const instruments = [
  { symbol: 'AAPL', name: 'Apple Inc.' },
  { symbol: 'MSFT', name: 'Microsoft Corporation' },
  { symbol: 'TSLA', name: 'Tesla Inc.' },
];
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

function showSelector(initialValue = '', options: { disabled?: boolean; error?: string; empty?: boolean } = {}) {
  const selections: string[] = [];
  function Harness() {
    const [value, setValue] = useState(initialValue);
    return <>
      <InstrumentSelector instruments={options.empty ? [] : instruments} value={value}
        disabled={options.disabled} error={options.error}
        onChange={(symbol) => { selections.push(symbol); setValue(symbol); }} />
      <button type="button" onClick={() => setValue('')}>Reset selection</button>
    </>;
  }
  const view = render(<Harness />);
  return { ...view, selections };
}

function focusInput() {
  const input = screen.getByRole('combobox', { name: 'Ticker' }) as HTMLInputElement;
  act(() => input.focus());
  return input;
}

test('a labelled combobox starts collapsed and opens the supplied catalogue on focus', () => {
  showSelector();
  const input = screen.getByLabelText('Ticker');
  assert.equal(input.getAttribute('aria-expanded'), 'false');
  assert.equal(screen.queryByRole('listbox') === null, true);
  focusInput();
  assert.equal(input.getAttribute('aria-autocomplete'), 'list');
  assert.equal(input.getAttribute('aria-controls'), screen.getByRole('listbox').id);
  assert.equal(screen.getAllByRole('option').length, 3);
  assert.ok(screen.getByRole('option', { name: /AAPL.*Apple Inc/ }));
});

for (const [search, symbol] of [[' ms ', 'MSFT'], ['pPlE', 'AAPL']]) {
  test(`searching ${search} matches ticker or company name without case sensitivity`, () => {
    const h = showSelector();
    const input = focusInput();
    fireEvent.change(input, { target: { value: search } });
    const options = screen.getAllByRole('option');
    assert.equal(options.length, 1);
    assert.ok(options[0]?.textContent?.includes(symbol!));
    assert.equal(input.value, search);
    assert.deepEqual(h.selections, ['']);
  });
}

test('mouse selection commits only the symbol and keeps focus in the input', () => {
  const h = showSelector();
  const input = focusInput();
  const option = screen.getByRole('option', { name: /MSFT/ });
  assert.equal(fireEvent.mouseDown(option), false);
  fireEvent.click(option);
  assert.deepEqual(h.selections, ['MSFT']);
  assert.equal(input.value, 'MSFT');
  assert.equal(input.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement === input, true);
});

test('editing a selected ticker clears its committed value and never commits arbitrary search text', () => {
  const h = showSelector('AAPL');
  const input = focusInput();
  fireEvent.change(input, { target: { value: 'not-an-instrument' } });
  assert.deepEqual(h.selections, ['']);
  assert.ok(screen.getByRole('status').textContent?.includes('No matching instruments'));
  fireEvent.keyDown(input, { key: 'Enter' });
  assert.deepEqual(h.selections, ['']);
  fireEvent.blur(input);
  assert.equal(input.value, '');
});

test('arrows highlight options; Enter selects without moving DOM focus or submitting', () => {
  const h = showSelector();
  const input = focusInput();
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  assert.equal(screen.getByRole('option', { selected: true }).textContent?.includes('AAPL'), true);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  const highlighted = screen.getByRole('option', { selected: true });
  assert.equal(highlighted.textContent?.includes('MSFT'), true);
  assert.equal(input.getAttribute('aria-activedescendant'), highlighted.id);
  assert.equal(fireEvent.keyDown(input, { key: 'Enter' }), false);
  assert.deepEqual(h.selections, ['MSFT']);
  assert.equal(document.activeElement === input, true);
  assert.equal(input.hasAttribute('aria-activedescendant'), false);
  assert.equal(fireEvent.keyDown(input, { key: 'Enter' }), false);
});

test('ArrowUp opens at the last option and navigation stops at the boundary', () => {
  showSelector();
  const input = focusInput();
  fireEvent.keyDown(input, { key: 'Escape' });
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  assert.equal(screen.getByRole('option', { selected: true }).textContent?.includes('TSLA'), true);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  assert.equal(screen.getByRole('option', { selected: true }).textContent?.includes('TSLA'), true);
});

test('changing a search resets its highlighted result before Enter commits', () => {
  const h = showSelector();
  const input = focusInput();
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  fireEvent.change(input, { target: { value: 'apple' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  assert.equal(h.selections.at(-1), 'AAPL');
});

test('Escape dismisses browsing without replacing the existing selection', () => {
  const h = showSelector('AAPL');
  const input = focusInput();
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Escape' });
  assert.equal(screen.queryByRole('listbox') === null, true);
  assert.equal(input.value, 'AAPL');
  assert.deepEqual(h.selections, []);
});

test('Tab closes without preventing focus navigation or choosing a suggestion', () => {
  const h = showSelector();
  const input = focusInput();
  fireEvent.change(input, { target: { value: 'micro' } });
  assert.equal(fireEvent.keyDown(input, { key: 'Tab' }), true);
  assert.equal(screen.queryByRole('listbox') === null, true);
  assert.deepEqual(h.selections, ['']);
});

test('clicking away closes without committing a search result', () => {
  const h = showSelector();
  const input = focusInput();
  fireEvent.change(input, { target: { value: 'micro' } });
  act(() => screen.getByRole('button', { name: 'Reset selection' }).focus());
  assert.equal(screen.queryByRole('listbox') === null, true);
  assert.deepEqual(h.selections, ['']);
});

test('a parent reset clears the displayed selected ticker', () => {
  showSelector('AAPL');
  fireEvent.click(screen.getByRole('button', { name: 'Reset selection' }));
  assert.equal((screen.getByLabelText('Ticker') as HTMLInputElement).value, '');
});

test('disabled selectors cannot open or change the committed value', () => {
  const h = showSelector('AAPL', { disabled: true });
  const input = screen.getByLabelText('Ticker') as HTMLInputElement;
  assert.equal(input.disabled, true);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  assert.equal(screen.queryByRole('listbox') === null, true);
  assert.deepEqual(h.selections, []);
});

test('empty catalogues provide feedback without inventing an option', () => {
  showSelector('', { empty: true });
  focusInput();
  assert.ok(screen.getByRole('status').textContent?.includes('No instruments available'));
  assert.equal(screen.queryByRole('option') === null, true);
});

test('parent validation errors are linked to the input', () => {
  showSelector('', { error: 'Choose an instrument from the list.' });
  const input = screen.getByLabelText('Ticker');
  assert.equal(input.getAttribute('aria-invalid'), 'true');
  const error = document.getElementById(input.getAttribute('aria-describedby')!);
  assert.equal(error?.textContent, 'Choose an instrument from the list.');
});

test('Enter while composing text does not select or interfere with IME input', () => {
  const h = showSelector();
  const input = focusInput();
  fireEvent.change(input, { target: { value: 'apple' } });
  assert.equal(fireEvent.keyDown(input, { key: 'Enter', isComposing: true }), true);
  assert.deepEqual(h.selections, ['']);
  assert.equal(input.getAttribute('aria-expanded'), 'true');
});
