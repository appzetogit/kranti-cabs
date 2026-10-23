import React, { useState, useEffect, Fragment } from 'react';
import { Loader2, ChevronRight, ChevronDown, ShieldAlert, RefreshCw } from 'lucide-react';
import { adminService } from '../../services/adminService';
import toast from 'react-hot-toast';

const DAY_OPTIONS = [1, 7, 30];

const RESULT_LABELS = {
  accepted: 'Accepted',
  retry: 'Retry (already theirs)',
  lost: 'Lost to another driver',
  not_offered: 'Not offered to them',
  rate_limited: 'Rate limited',
  refused: 'Refused (not eligible)',
};

const ms = (value) => (value === null || value === undefined ? '—' : `${Number(value).toLocaleString('en-IN')} ms`);
const when = (value) => (value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

/**
 * Ride-accept speed per driver, for spotting auto clicker use.
 *
 * Flags are for review only: the server already blocks the abuse it can
 * (unoffered rides, rate limit, one winner per ride), and a fast thumb is not
 * proof of a tool.
 */
const AcceptSpeedReview = () => {
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ results: [], fastMs: 400, minAccepts: 5 });
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [openDriver, setOpenDriver] = useState(null);
  const [attempts, setAttempts] = useState({});

  const load = async () => {
    try {
      setLoading(true);
      const res = await adminService.getAcceptSpeedReview({ days });
      setData(res?.data || res || { results: [] });
    } catch {
      toast.error('Failed to load accept speed review');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const toggleDriver = async (driverId) => {
    if (openDriver === driverId) {
      setOpenDriver(null);
      return;
    }
    setOpenDriver(driverId);
    if (attempts[driverId]) return;
    try {
      const res = await adminService.getDriverAcceptAttempts(driverId);
      setAttempts((prev) => ({ ...prev, [driverId]: res?.data?.results || res?.results || [] }));
    } catch {
      toast.error('Failed to load attempts');
    }
  };

  const rows = (data.results || []).filter((row) => (flaggedOnly ? row.flagged : true));
  const flaggedCount = (data.results || []).filter((row) => row.flagged).length;

  return (
    <div className="min-h-screen bg-gray-50 p-6 lg:p-8">
      <div className="mb-6">
        <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
          <span>Driver Management</span>
          <ChevronRight size={12} />
          <span className="text-gray-700">Accept Speed Review</span>
        </div>
        <h1 className="text-xl font-semibold text-gray-900">Accept Speed Review</h1>
        <p className="text-sm text-gray-500 mt-1 max-w-3xl">
          How fast each driver accepts ride offers, measured on the server from the offer going out to the accept
          arriving (network delay included). A driver is flagged when most accepts are faster than {data.fastMs} ms
          (at least {data.minAccepts} accepts), or they keep hitting the accept limit or accepting rides not offered to
          them. Flags are for review, not proof — fast drivers exist. Nobody is blocked automatically.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200">
        <div className="flex items-center gap-3 p-4 border-b border-gray-100 flex-wrap">
          <div className="inline-flex bg-gray-100 rounded-lg p-1">
            {DAY_OPTIONS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setDays(value)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  days === value ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Last {value === 1 ? '24 h' : `${value} days`}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={flaggedOnly}
              onChange={(e) => setFlaggedOnly(e.target.checked)}
              className="w-4 h-4 accent-indigo-600"
            />
            Flagged only ({flaggedCount})
          </label>
          <button
            type="button"
            onClick={load}
            className="ml-auto flex items-center gap-2 text-sm text-gray-600 hover:text-indigo-600"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="animate-spin" size={22} />
          </div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-500">
            {flaggedOnly ? 'No flagged drivers in this period.' : 'No ride accepts recorded in this period.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="w-8" />
                  <th className="text-left font-semibold px-4 py-3">Driver</th>
                  <th className="text-right font-semibold px-4 py-3">Accepts</th>
                  <th className="text-right font-semibold px-4 py-3">Under {data.fastMs} ms</th>
                  <th className="text-right font-semibold px-4 py-3">Median</th>
                  <th className="text-right font-semibold px-4 py-3">Fastest</th>
                  <th className="text-right font-semibold px-4 py-3">Rate limited</th>
                  <th className="text-right font-semibold px-4 py-3">Not offered</th>
                  <th className="text-left font-semibold px-4 py-3">Why flagged</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Fragment key={row.driverId}>
                    <tr
                      onClick={() => toggleDriver(row.driverId)}
                      className={`border-t border-gray-100 cursor-pointer hover:bg-gray-50/60 ${row.flagged ? 'bg-amber-50/40' : ''}`}
                    >
                      <td className="pl-4 text-gray-400">
                        {openDriver === row.driverId ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900 flex items-center gap-1.5">
                          {row.flagged && <ShieldAlert size={14} className="text-amber-600" />}
                          {row.name || 'Unnamed driver'}
                        </div>
                        <div className="text-xs text-gray-400">{row.phone || row.driverId}</div>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">{row.accepts}</td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {row.fastAccepts}
                        {row.accepts ? <span className="text-gray-400"> ({Math.round(row.fastShare * 100)}%)</span> : null}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">{ms(row.medianReactionMs)}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{ms(row.fastestReactionMs)}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{row.rateLimited || '—'}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{row.notOffered || '—'}</td>
                      <td className="px-4 py-3 text-xs text-amber-700">{row.reasons.join('; ') || ''}</td>
                    </tr>
                    {openDriver === row.driverId && (
                      <tr className="bg-gray-50/70">
                        <td />
                        <td colSpan={8} className="px-4 py-3">
                          {!attempts[row.driverId] ? (
                            <Loader2 className="animate-spin text-gray-400" size={16} />
                          ) : attempts[row.driverId].length === 0 ? (
                            <span className="text-xs text-gray-500">No attempts recorded.</span>
                          ) : (
                            <table className="w-full text-xs">
                              <thead className="text-gray-400">
                                <tr>
                                  <th className="text-left font-medium py-1">When</th>
                                  <th className="text-left font-medium py-1">Result</th>
                                  <th className="text-right font-medium py-1">Reaction</th>
                                  <th className="text-left font-medium py-1 pl-4">From</th>
                                  <th className="text-left font-medium py-1">Ride</th>
                                </tr>
                              </thead>
                              <tbody>
                                {attempts[row.driverId].map((attempt, index) => (
                                  <tr key={`${attempt.at}-${index}`} className="border-t border-gray-100">
                                    <td className="py-1 text-gray-600">{when(attempt.at)}</td>
                                    <td className="py-1 text-gray-700">{RESULT_LABELS[attempt.result] || attempt.result}</td>
                                    <td className="py-1 text-right text-gray-700">{ms(attempt.reactionMs)}</td>
                                    <td className="py-1 pl-4 text-gray-500">{attempt.channel === 'rest' ? 'Offer card' : 'App'}</td>
                                    <td className="py-1 text-gray-400 font-mono">{attempt.rideId || '—'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default AcceptSpeedReview;
