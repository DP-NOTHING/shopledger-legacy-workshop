var test = require('node:test');
var assert = require('node:assert/strict');
var pricing = require('../lib/pricing');
var invoice = require('../lib/invoice');
var reports = require('../lib/reports');

function order(id, items, coupon) {
  var totals = pricing.computeTotals(items, coupon || '');
  return {
    id: id,
    date: '2026-11-22',
    customer: 'Test Customer',
    coupon: coupon || '',
    status: 'completed',
    items: items,
    subtotal: totals.subtotal,
    discount: totals.discount,
    tax: totals.tax,
    total: totals.total
  };
}

test('invoice correct behaviour: figures match checkout discount, HSN GST, and billed total', function () {
  var o = order(1002, [
    { id: 1, name: 'Rice', hsn: '1006', price: 510, qty: 1 },
    { id: 2, name: 'Dal', hsn: '0713', price: 510, qty: 1 }
  ], 'SAVE10');
  var inv = invoice.computeInvoiceFigures(o);

  assert.deepEqual(
    { subtotal: inv.subtotal, discount: inv.discount, tax: inv.tax, total: inv.total },
    { subtotal: o.subtotal, discount: o.discount, tax: o.tax, total: o.total }
  );
  assert.deepEqual(inv.rows.map(function (row) { return row.gstPercent; }), [5, 5]);
});

test('invoice figures use the checkout SAVE10 discount and post-discount HSN tax', function () {
  var o = order(1002, [
    { id: 1, name: 'Rice', hsn: '1006', price: 510, qty: 1 },
    { id: 2, name: 'Dal', hsn: '0713', price: 510, qty: 1 }
  ], 'SAVE10');

  assert.deepEqual(
    { subtotal: o.subtotal, discount: o.discount, tax: o.tax, total: o.total },
    { subtotal: 1020, discount: 102, tax: 45.9, total: 963.9 }
  );
  assert.deepEqual(
    (({ subtotal, discount, tax, total }) => ({ subtotal, discount, tax, total }))(invoice.computeInvoiceFigures(o)),
    { subtotal: 1020, discount: 102, tax: 45.9, total: 963.9 }
  );
});

test('invoice applies SAVE10 discount cap consistently with checkout', function () {
  var o = order(1004, [{ id: 3, name: 'Wholesale goods', hsn: '1006', price: 2240, qty: 1 }], 'SAVE10');
  var inv = invoice.computeInvoiceFigures(o);

  assert.equal(o.discount, 150);
  assert.equal(inv.discount, 150);
  assert.equal(inv.total, o.total);
});

test('invoice resolves 5% and 12% GST from HSN slabs when line items omit gstRate', function () {
  var fivePercent = order(1001, [{ id: 4, name: 'Grain', hsn: '1006', price: 100, qty: 1 }]);
  var twelvePercent = order(1007, [{ id: 5, name: 'Ghee', hsn: '0405', price: 100, qty: 1 }]);

  assert.equal(fivePercent.tax, 5);
  assert.equal(invoice.computeInvoiceFigures(fivePercent).tax, 5);
  assert.equal(twelvePercent.tax, 12);
  assert.equal(invoice.computeInvoiceFigures(twelvePercent).tax, 12);
});

test('GST reconciliation matches checkout figures across coupons and HSN slabs', function () {
  var db = { orders: [
    order(1001, [{ id: 4, name: 'Grain', hsn: '1006', price: 100, qty: 1 }]),
    order(1002, [{ id: 1, name: 'Rice', hsn: '1006', price: 510, qty: 1 }, { id: 2, name: 'Dal', hsn: '0713', price: 510, qty: 1 }], 'SAVE10'),
    order(1004, [{ id: 3, name: 'Wholesale goods', hsn: '1006', price: 2240, qty: 1 }], 'SAVE10'),
    order(1007, [{ id: 5, name: 'Ghee', hsn: '0405', price: 100, qty: 1 }]),
    order(1008, [{ id: 6, name: 'Tea', hsn: '0902', price: 100, qty: 1 }])
  ] };
  var result = reports.getGstReconciliation(db);

  assert.equal(result.totalChecked, 5);
  assert.equal(result.mismatchCount, 0);
  assert.deepEqual(result.rows.map(function (row) { return row.matched; }), [true, true, true, true, true]);
  assert.equal(result.rows[4].invoiceTotal, db.orders[4].total);
  assert.equal(result.rows[4].invoiceTax, db.orders[4].tax);
});
