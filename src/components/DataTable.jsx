import { useEffect, useRef, useState } from 'react'
import { DataTable as PrimeTable } from 'primereact/datatable'
import { Column } from 'primereact/column'
import { Search, Download } from 'lucide-react'
import { Input, SecondaryButton } from './FormControls.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import { DATA_TABLE_TEXT } from '../i18n/dataTable.js'

// Thin wrapper around PrimeReact's DataTable: a global search box, per-column
// row filters, sortable headers, an internally scrolling body so the body
// never has to be so tall that the whole page scrolls, pagination with a
// rows-per-page picker, and a CSV export button.
//
// columns: [{ field, header, sortable, body: (row) => node, align, exportable, exportField }]
// exportField: which row property the "Export CSV" button reads for this
// column, when it differs from `field` — needed whenever `body` renders
// something a raw field value can't (a formatted/joined string, a code
// mapped to a label, JSX built from several row properties) so the CSV
// isn't left with the raw code or blank cells for that column.
// exportCSV() (below, wired to the toolbar's Export button) always exports
// every row regardless of the current page — pagination only limits what's
// on screen, never what's in the CSV.
//
// Pagination + the internal scroll (scrollHeight) work together, not as
// alternatives: pagination caps how many rows render at once (so a table
// with thousands of rows doesn't choke the DOM), while scrollHeight caps how
// tall even one page of rows is allowed to get — e.g. rowsPerPageOptions
// lets a manager pick 50 or 100 rows per page, and THAT'S when the internal
// scrollbar actually earns its keep instead of sitting unused at the
// default 10-per-page size.
export default function DataTable({
  columns,
  data,
  rowKey = 'id',
  globalFilterFields,
  searchPlaceholder,
  defaultSortField,
  defaultSortOrder = 1,
  scrollHeight = '360px',
  emptyMessage,
  onRowClick,
  exportFilename = 'export',
  selectable = false,
  selection,
  onSelectionChange,
  dense = false,
  toolbarActions,
  leadingContent,
  trailingContent,
  scrollable = true,
  hideExport = false,
  paginator = true,
  rows = 10,
  rowsPerPageOptions = [10, 25, 50, 100],
  // When true, the table fills exactly whatever height its own container
  // gives it (that container must itself be height-bounded — e.g. a flex
  // child with min-h-0 inside a page that opts into `lg:h-full`, see
  // Layout.jsx/Employees.jsx) instead of using a guessed `calc(100vh - Npx)`
  // pixel offset for `scrollHeight`. A fixed offset has to be re-tuned by
  // hand every time that page's own header/toolbar content changes height,
  // and still drifts across browsers/zoom/font-rendering differences —
  // this self-adjusts instead, so the table can never be responsible for
  // the page needing to scroll.
  fillHeight = false,
}) {
  const { language } = useLanguage()
  const dt = DATA_TABLE_TEXT[language]
  const [globalFilter, setGlobalFilter] = useState('')
  const tableRef = useRef(null)
  // Controlled (rather than left to PrimeReact's own internal state) purely
  // so the search box below can reset back to page 1 — otherwise typing a
  // search that narrows 80 rows down to 3 could leave the paginator sitting
  // on "page 4 of 1", showing an empty table for a query that actually has
  // matches.
  const [pageState, setPageState] = useState({ first: 0, rows })
  useEffect(() => {
    setPageState((p) => (p.first === 0 ? p : { ...p, first: 0 }))
  }, [globalFilter])

  const showToolbar = !!globalFilterFields || !!toolbarActions || !!leadingContent || !!trailingContent || !hideExport

  return (
    // overflow-x-auto so that if the table's rendered width ever exceeds its
    // container by even a pixel or two (e.g. a header/body scrollbar-gutter
    // mismatch on a system with always-visible scrollbars, or a very narrow
    // window) that overflow scrolls locally, right here, instead of forcing
    // a horizontal scrollbar on the whole page — the same problem the
    // vertical scrollHeight cap already solves for height.
    // flex-1 (not h-full) — some fillHeight call sites (e.g. Fuel Entry's
    // "Entry History" title bar) render a sibling ABOVE this in the same
    // flex-col card; h-full would size this to 100% of the card regardless
    // of what that sibling already took, overflowing the card's own bounds.
    // flex-1 correctly shares whatever's actually left over instead.
    <div className={fillHeight ? 'flex min-h-0 flex-1 flex-col overflow-x-auto' : 'overflow-x-auto'}>
      {showToolbar ? (
        <div
          className={`flex flex-col gap-3 border-b border-slate-100 sm:flex-row sm:items-center sm:justify-between ${
            dense ? 'p-2' : 'p-3'
          }`}
        >
          <div className="flex flex-wrap items-center gap-3">
            {leadingContent}
            {globalFilterFields ? (
              <div className="relative w-full sm:w-auto sm:max-w-xs">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  value={globalFilter}
                  onChange={(e) => setGlobalFilter(e.target.value)}
                  placeholder={searchPlaceholder ?? dt.searchPlaceholder}
                  className="py-2 pl-9 text-sm"
                />
              </div>
            ) : null}
            {/* Placed after the search box (not grouped with leadingContent)
                so a crowded toolbar wraps THIS to a second line before it
                ever pushes the search box itself down — search stays usable
                on the first row even when the row runs out of width. */}
            {trailingContent}
          </div>
          <div className="flex shrink-0 items-center gap-2 self-start">
            {toolbarActions}
            {hideExport ? null : (
              <SecondaryButton
                onClick={() => tableRef.current?.exportCSV()}
                className="shrink-0 border-brand-300 bg-brand-100 px-3.5 py-2 text-xs text-brand-800 hover:bg-brand-200"
              >
                <Download size={14} /> {dt.exportCsv}
              </SecondaryButton>
            )}
          </div>
        </div>
      ) : null}

      <div className={fillHeight ? 'min-h-0 flex-1' : undefined}>
      <PrimeTable
        ref={tableRef}
        value={data}
        dataKey={rowKey}
        locale={language === 'ta' ? 'ta' : 'en'}
        scrollable={scrollable}
        scrollHeight={scrollable ? (fillHeight ? 'flex' : scrollHeight) : undefined}
        tableStyle={dense ? { tableLayout: 'fixed', width: '100%' } : undefined}
        globalFilter={globalFilter}
        globalFilterFields={globalFilterFields}
        sortField={defaultSortField}
        sortOrder={defaultSortOrder}
        removableSort
        emptyMessage={emptyMessage ?? dt.emptyMessage}
        className={
          [
            onRowClick ? 'p-datatable-row-clickable' : '',
            dense ? 'p-datatable-dense' : '',
            !scrollable ? 'p-datatable-no-scroll' : '',
          ]
            .filter(Boolean)
            .join(' ') || undefined
        }
        onRowClick={onRowClick ? (e) => onRowClick(e.data) : undefined}
        exportFilename={exportFilename}
        selection={selectable ? selection : undefined}
        onSelectionChange={selectable && onSelectionChange ? (e) => onSelectionChange(e.value) : undefined}
        paginator={paginator}
        first={pageState.first}
        rows={pageState.rows}
        rowsPerPageOptions={rowsPerPageOptions}
        onPage={(e) => setPageState({ first: e.first, rows: e.rows })}
        paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink RowsPerPageDropdown CurrentPageReport"
        currentPageReportTemplate={dt.paginatorReport}
      >
        {selectable ? <Column selectionMode="multiple" headerStyle={{ width: '3rem' }} /> : null}
        {columns.map((col) => (
          <Column
            key={col.field || col.header}
            field={col.field}
            header={col.header}
            sortable={col.sortable}
            body={col.body}
            style={col.style}
            align={col.align}
            alignHeader={col.align}
            exportable={col.exportable !== undefined ? col.exportable : !!col.field}
            exportField={col.exportField}
          />
        ))}
      </PrimeTable>
      </div>
    </div>
  )
}
