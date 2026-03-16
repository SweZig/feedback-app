import { useState } from 'react';
import { getFilteredResponses, getResponsesByDateRange } from '../utils/storage';
import { calculateNps } from '../utils/npsCalculations';
import { exportCsv, exportExcel } from '../utils/export';
import DistributionBar from './DistributionBar';
import CommentList from './CommentList';
import './ReportPage.css';

const TIME_FILTERS = [
  { label: '7 dagar', days: 7 },
  { label: '30 dagar', days: 30 },
  { label: '90 dagar', days: 90 },
  { label: 'Alla', days: null },
];

function ReportPage({ activeCustomer }) {
  const [filterDays, setFilterDays] = useState(null);
  const [dateRange, setDateRange] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const customerId = activeCustomer?.id || null;

  const responses = dateRange
    ? getResponsesByDateRange(fromDate, toDate, customerId)
    : getFilteredResponses(filterDays, customerId);
  const result = calculateNps(responses);

  function handlePresetClick(days) {
    setDateRange(false);
    setFilterDays(days);
  }

  function handleDateRangeClick() {
    setDateRange(true);
  }

  return (
    <div className="report">
      {activeCustomer && (
        <h2 className="report-title">Rapport: {activeCustomer.name}</h2>
      )}

      <div className="report-filters">
        {TIME_FILTERS.map((f) => (
          <button
            key={f.label}
            className={`filter-btn ${!dateRange && filterDays === f.days ? 'filter-btn--active' : ''}`}
            onClick={() => handlePresetClick(f.days)}
          >
            {f.label}
          </button>
        ))}
        <button
          className={`filter-btn ${dateRange ? 'filter-btn--active' : ''}`}
          onClick={handleDateRangeClick}
        >
          Datumintervall
        </button>
      </div>

      {dateRange && (
        <div className="date-range">
          <label className="date-range-field">
            Från
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </label>
          <label className="date-range-field">
            Till
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </label>
        </div>
      )}

      {!result ? (
        <div className="report-card report-empty">
          <p>Inga svar ännu{activeCustomer ? ` för ${activeCustomer.name}` : ''}.</p>
        </div>
      ) : (
        <>
          <div className="report-card report-nps">
            <div className="nps-score">{result.nps}</div>
            <div className="nps-label">NPS-poäng</div>
            <div className="nps-meta">{result.total} svar</div>
          </div>

          <div className="report-card">
            <h3>Fördelning</h3>
            <DistributionBar
              percentages={result.percentages}
              counts={result.counts}
            />
          </div>

          {(() => {
            const answerCounts = {};
            responses.forEach((r) => {
              if (r.predefinedAnswer) {
                answerCounts[r.predefinedAnswer] = (answerCounts[r.predefinedAnswer] || 0) + 1;
              }
            });
            const entries = Object.entries(answerCounts).sort((a, b) => b[1] - a[1]);
            if (entries.length === 0) return null;
            return (
              <div className="report-card">
                <h3>Svarsalternativ</h3>
                <ul className="answer-summary">
                  {entries.map(([answer, count]) => (
                    <li key={answer} className="answer-summary-item">
                      <span className="answer-summary-label">{answer}</span>
                      <div className="answer-summary-bar-wrap">
                        <div
                          className="answer-summary-bar"
                          style={{ width: `${Math.round((count / result.total) * 100)}%` }}
                        />
                      </div>
                      <span className="answer-summary-count">{count}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })()}

          {activeCustomer?.freeTextEnabled !== false && (
            <div className="report-card">
              <CommentList responses={responses} />
            </div>
          )}

          <div className="report-export">
            <button className="export-btn" onClick={() => exportCsv(responses)}>
              Exportera CSV
            </button>
            <button className="export-btn" onClick={() => exportExcel(responses)}>
              Exportera Excel
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default ReportPage;
