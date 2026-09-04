import { useEffect, useRef, useState } from 'react'
import { DataTable as PrimeTable } from 'primereact/datatable'
import { Column } from 'primereact/column'
import { Search, Download } from 'lucide-react'
import { Input, SecondaryButton } from './FormControls.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import { DATA_TABLE_TEXT } from '../i18n/dataTable.js'

// Thin wrapper around PrimeReact's DataTable: a global search box, per-column
// row filters, sortable headers, an internally scrolling body so the body
// never has to be so tall that the whole page scrolls, and a CSV export button.
//
// columns: [{ field, header, sortable, filter, body: (row) => node, align, filterPlaceholder, exportable, exportField }]
// exportField: which row property the "Export CSV" button reads for this
// column, when it differs from `field` — needed whenever `body` renders
// something a raw field value can't (a formatted/joined string, a code
// mapped to a label, JSX built from several row properties) so the CSV
// isn't left with the raw code or blank cells for that column.
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
  paginator = true,
  rows = 5,
  rowsPerPageOptions = [5, 10, 20, 50],
  dense = false,
  toolbarActions,
  leadingContent,
  trailingContent,
  scrollable = true,
  hideExport = false,
}) {
  const { language } = useLanguage()
  const dt = DATA_TABLE_TEXT[language]
  const [globalFilter, setGlobalFilter] = useState('')
  const tableRef = useRef(null)

  // When a row is added (data grows), jump back to page 1 — otherwise a new
  // row can land on a later page (via sorting) and adding it silently looks
  // like nothing happened.
  const [first, setFirst] = useState(0)
  const prevLengthRef = useRef(data.length)
  useEffect(() => {
    if (data.length > prevLengthRef.current) {
      setFirst(0)
    }
    prevLengthRef.current = data.length
  }, [data.length])

  const showToolbar = !!globalFilterFields || !!toolbarActions || !!leadingContent || !!trailingContent || !hideExport

  return (
    <div>
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

      <PrimeTable
        ref={tableRef}
        value={data}
        dataKey={rowKey}
        locale={language === 'ta' ? 'ta' : 'en'}
        scrollable={scrollable}
        scrollHeight={scrollable ? scrollHeight : undefined}
        tableStyle={dense ? { tableLayout: 'fixed', width: '100%' } : undefined}
        globalFilter={globalFilter}
        globalFilterFields={globalFilterFields}
        sortField={defaultSortField}
        sortOrder={defaultSortOrder}
        removableSort
        paginator={paginator}
        rows={rows}
        first={first}
        onPage={(e) => setFirst(e.first)}
        rowsPerPageOptions={rowsPerPageOptions}
        alwaysShowPaginator
        paginatorTemplate="FirstPageLink PrevPageLink PageLinks NextPageLink LastPageLink RowsPerPageDropdown CurrentPageReport"
        currentPageReportTemplate={dt.currentPageReport}
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
      >
        {selectable ? <Column selectionMode="multiple" headerStyle={{ width: '3rem' }} /> : null}
        {columns.map((col) => (
          <Column
            key={col.field || col.header}
            field={col.field}
            header={col.header}
            sortable={col.sortable}
            filter={col.filter}
            filterPlaceholder={col.filterPlaceholder || dt.searchColumn(col.header)}
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
  )
}
