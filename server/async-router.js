/**
 * Petit utilitaire : un routeur Express 4 qui attrape automatiquement les
 * rejets de promesses. Les handlers (et middlewares) asynchrones qui
 * `throw` sont transmis à `next(err)` au lieu de rester bloqués — Express 4
 * ne le fait pas nativement.
 *
 * Usage (identique à express.Router()) :
 *   const router = createAsyncRouter();
 *   router.get('/', async (req, res) => { … });
 */
import express from 'express';

const isMiddleware = (fn) => typeof fn === 'function' && fn.length < 4; // 4 args = gestionnaire d'erreur

const wrap = (fn) =>
  isMiddleware(fn)
    ? (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)
    : fn;

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all', 'use', 'options', 'head'];

export function createAsyncRouter(options) {
  const router = express.Router(options);
  for (const method of METHODS) {
    const original = router[method].bind(router);
    router[method] = (...args) => original(...args.map(wrap));
  }
  return router;
}

export default createAsyncRouter;
