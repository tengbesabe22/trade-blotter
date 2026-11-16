import { useMemo } from 'react';
import { CellStyleModule, ClientSideRowModelModule, themeQuartz, type ColDef } from 'ag-grid-community';
import { AgGridProvider, AgGridReact, type CustomCellRendererProps } from 'ag-grid-react';
import type { CurrentUser } from '../api/contracts/auth/auth-contract';
import type { Trade } from '../api/contracts/trades/trade-contract';
import { TradeActionButton } from './TradeActionButton';

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
  // Sorting is performed by the API across the full result set.
  sortable: false,
  resizable: true,
  minWidth: 90,
  // Keep exact financial values as strings for display.
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
  },
  {
    field: 'price',
    headerName: 'Price (USD)',
    width: 140,
    type: 'rightAligned',
    cellClass: 'ag-right-aligned-cell tabular-nums',
  },
  { field: 'status', width: 140, cellClass: 'font-medium' },
  { field: 'trader', width: 120 },
  {
    field: 'tradeDate',
    headerName: 'Execution time (UTC)',
    width: 235,
    valueFormatter: ({ value }) => value ? value.replace('T', ' ').replace('Z', '') : '',
  },
  { field: 'book', width: 175, valueFormatter: ({ value }) => value ?? '—' },
  { field: 'counterparty', width: 190, valueFormatter: ({ value }) => value ?? '—' },
  { field: 'id', headerName: 'Trade ID', width: 315 },
];

type TradeTableProps = {
  trades: Trade[];
  user: CurrentUser;
  onAmend: (trade: Trade) => void;
  onCancel: (trade: Trade) => void;
  onHistory: (trade: Trade) => void;
  actionsDisabled: boolean;
};

export function TradeTable({ trades, user, onAmend, onCancel, onHistory, actionsDisabled }: TradeTableProps) {
  const actionColumn = useMemo<ColDef<Trade>>(() => ({
    colId: 'actions', headerName: 'Actions', pinned: 'right', width: user.role === 'TRADER' ? 124 : 80, minWidth: user.role === 'TRADER' ? 124 : 80,
    cellStyle: { paddingLeft: 8, paddingRight: 8 },
    cellRenderer: ({ data }: CustomCellRendererProps<Trade>) => {
      if (!data) return null;
      const canEdit = user.role === 'TRADER' && data.ownerId === user.id && data.status === 'ACTIVE';
      return (
        <div className="flex h-full items-center gap-1">
          <TradeActionButton action="history" label={`History ${data.symbol} trade ${data.id}`}
            disabled={actionsDisabled} onClick={() => onHistory(data)} />
          {canEdit && (
            <>
              <TradeActionButton action="amend" label={`Amend ${data.symbol} trade ${data.id}`}
                disabled={actionsDisabled} onClick={() => onAmend(data)} />
              <TradeActionButton action="cancel" label={`Cancel ${data.symbol} trade ${data.id}`}
                disabled={actionsDisabled} onClick={() => onCancel(data)} />
            </>
          )}
        </div>
      );
    },
  }), [user.id, user.role, onAmend, onCancel, onHistory, actionsDisabled]);
  // Live row changes must not rebuild column definitions and reset resized widths.
  const tableColumns = useMemo(() => [...columns, actionColumn], [actionColumn]);

  return (
    <div className="relative min-h-72 w-full flex-1">
      {/* Fill the flexible slot without the grid dictating the card height. */}
      <div className="absolute inset-0">
        <AgGridProvider modules={modules}>
          <AgGridReact<Trade>
            theme={theme}
            rowData={trades}
            suppressScrollOnNewData
            columnDefs={tableColumns}
            defaultColDef={defaultColumn}
            getRowId={({ data }) => data.id}
            rowHeight={44}
            headerHeight={44}
          />
        </AgGridProvider>
      </div>
    </div>
  );
}
