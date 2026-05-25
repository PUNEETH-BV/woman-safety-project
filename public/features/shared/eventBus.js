/**
 * SafeGuard Event Bus — Shared pub/sub for cross-feature communication
 * Usage:
 *   import { emit, on, off } from './eventBus.js'
 *   on('SOS_TRIGGERED', (data) => { ... })
 *   emit('SOS_TRIGGERED', { type: 'MANUAL', gps: {...} })
 */
const EventBus = (() => {
  const listeners = new Map();

  function on(event, callback) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(callback);
  }

  function off(event, callback) {
    if (listeners.has(event)) {
      listeners.get(event).delete(callback);
    }
  }

  function emit(event, data) {
    if (listeners.has(event)) {
      listeners.get(event).forEach(cb => {
        try { cb(data); } catch (e) { console.error(`[EventBus] Error in "${event}" handler:`, e); }
      });
    }
    // Also dispatch a CustomEvent on window so any page can listen
    window.dispatchEvent(new CustomEvent('safeguard:' + event, { detail: data }));
  }

  return { on, off, emit };
})();

// Make globally accessible
window.SafeGuardBus = EventBus;
