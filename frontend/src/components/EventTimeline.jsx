import React, { useState } from "react";
import PropTypes from "prop-types";

export default function EventTimeline({ events }) {
  const [sortAsc, setSortAsc] = useState(false);
  return (
    <div className="border border-slate-700/60 rounded-xl overflow-hidden bg-slate-900 shadow-inner">
      <div className="bg-slate-800/40 px-5 py-3 border-b border-slate-700/60 flex justify-between items-center">
        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">
          Tracking Events & Timeline
        </h4>
        <span className="text-xs text-slate-500 font-medium">
          Total events: {events.length}
        </span>
      </div>
      {events.length > 0 ? (
        <table className="min-w-full divide-y divide-slate-800 text-sm">
          <thead className="bg-slate-950/40">
            <tr>
              <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <button
                  onClick={() => setSortAsc(!sortAsc)}
                  className="flex items-center gap-2 hover:text-slate-300 transition-colors"
                  title={sortAsc ? "Sort newest first" : "Sort oldest first"}
                >
                  Occurred At
                  <span className="text-[10px] ml-1">
                    {sortAsc ? "↑ Oldest" : "↓ Newest"}
                  </span>
                </button>
              </th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Description
              </th>
              <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Location
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800 bg-transparent">
            {[...events]
              .sort((a, b) =>
                sortAsc
                  ? new Date(a.carrierOccurredAt) - new Date(b.carrierOccurredAt)
                  : new Date(b.carrierOccurredAt) - new Date(a.carrierOccurredAt)
              )
              .map((event, index) => {
              const location =
                [event.cityLocality, event.stateProvince]
                  .filter(Boolean)
                  .join(", ") ||
                event.countryCode ||
                "";
              return (
                <tr
                  key={index}
                  className="hover:bg-slate-800/20 transition-colors"
                >
                  <td className="px-5 py-3 whitespace-nowrap text-slate-400 font-mono text-xs">
                    {new Date(event.carrierOccurredAt).toLocaleString()}
                  </td>
                  <td className="px-5 py-3 text-slate-200 font-medium text-xs">
                    {event.description}
                  </td>
                  <td className="px-5 py-3 text-slate-400 text-xs italic">
                    {location || "In Transit"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="p-6 text-center text-sm text-slate-500 italic">
          No events recorded yet.
        </div>
      )}
    </div>
  );
}

EventTimeline.propTypes = {
  events: PropTypes.arrayOf(
    PropTypes.shape({
      carrierOccurredAt: PropTypes.string.isRequired,
      description: PropTypes.string.isRequired,
      cityLocality: PropTypes.string,
      stateProvince: PropTypes.string,
      countryCode: PropTypes.string,
    })
  ).isRequired,
};
