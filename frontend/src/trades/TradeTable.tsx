import { CellStyleModule, ClientSideRowModelModule, themeQuartz, type ColDef } from 'ag-grid-community';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import type { Trade } from '../api/trade-contract';
import { compareDecimalStrings } from './trade-sort';

const modules = [ClientSideRowModelModule, CellStyleModule];
const theme = themeQuartz.withParams({
  accentColor: '#1d4ed8',
  backgroundColor: '#ffffff',
  foregroundColor: '#0f172a',
  headerBackgroundColor: '#f8fafc',
  headerTextColor: '#475569',
  borderColor: '#e2e8f0',
  fontFamily: 'inherit',
  fontSize: 13,
  borderRadius: 0,
  wrapperBorder: false,
});

const defaultColumn: ColDef<Trade> = {
  sortable: true,
  resizable: true,
  minWidth: 90,
  // Keep decimal strings as strings; numeric sorting is explicit on those columns.
  cellDataType: false,
};

const columns: ColDef<Trade>[] = [
  { field: 'symbol', headerName: 'Ticker', width: 110, pinned: 'left' },
  {
    field: 'side',
    width: 90,
    cellClassRules: {
      'font-semibold text-emerald-800': ({ value }) => value === 'BUY',
      'font-semibold text-blue-800': ({ value }) => value === 'SELL',
    },
  },
  {
    field: 'quantity',
    width: 155,
    type: 'rightAligned',
    cellClass: 'ag-right-aligned-cell tabular-nums',
    comparator: compareDecimalStrings,
  },
  {
    field: 'price',
    headerName: 'Price (USD)',
    width: 140,
    type: 'rightAligned',
    cellClass: 'ag-right-aligned-cell tabular-nums',
    comparator: compareDecimalStrings,
  },
  { field: 'status', width: 140, cellClass: 'font-medium' },
  { field: 'trader', width: 120 },
  {
    field: 'tradeDate',
    headerName: 'Execution time (UTC)',
    width: 235,
    sort: 'desc',
    valueFormatter: ({ value }) => value ? value.replace('T', ' ').replace('Z', '') : '',
  },
  { field: 'book', width: 175, valueFormatter: ({ value }) => value ?? '—' },
  { field: 'counterparty', width: 190, valueFormatter: ({ value }) => value ?? '—' },
  { field: 'id', headerName: 'Trade ID', width: 315 },
];

export function TradeTable({ trades }: { trades: Trade[] }) {
  return (
    <div className="h-[min(65svh,36rem)] min-h-72 w-full">
      <AgGridProvider modules={modules}>
        <AgGridReact<Trade>
          theme={theme}
          rowData={trades}
          columnDefs={columns}
          defaultColDef={defaultColumn}
          getRowId={({ data }) => data.id}
          rowHeight={44}
          headerHeight={44}
        />
      </AgGridProvider>
    </div>
  );
}
