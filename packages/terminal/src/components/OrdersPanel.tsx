import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import type { OrdersManager, OrderListItem, StoreListItem, Order, OrderItem } from '@hasna/assistants-core';
import { useSafeInput as useInput } from '../hooks/useSafeInput';

interface OrdersPanelProps {
  manager: OrdersManager;
  onClose: () => void;
}

type Mode =
  | 'overview'
  | 'orders'
  | 'stores'
  | 'order-detail'
  | 'order-create'
  | 'store-add';

type Tab = 'overview' | 'orders' | 'stores';

function formatRelativeTime(isoDate: string | null | undefined): string {
  if (!isoDate) return 'never';
  const diff = Date.now() - new Date(isoDate).getTime();
  const absDiff = Math.abs(diff);
  const seconds = Math.floor(absDiff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return `${seconds}s ago`;
}

function formatCurrency(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null) return '-';
  const cur = currency || 'USD';
  return `${cur} ${amount.toFixed(2)}`;
}

function statusColor(status: string): string {
  switch (status.toLowerCase()) {
    case 'pending': return 'yellow';
    case 'processing': return 'cyan';
    case 'shipped': return 'blue';
    case 'delivered': return 'green';
    case 'cancelled': return 'red';
    case 'returned': return 'magenta';
    default: return 'gray';
  }
}

export function OrdersPanel({ manager, onClose }: OrdersPanelProps) {
  const [mode, setMode] = useState<Mode>('overview');
  const [tab, setTab] = useState<Tab>('overview');
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [stores, setStores] = useState<StoreListItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Detail view state
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [detailItems, setDetailItems] = useState<OrderItem[]>([]);

  // Compose state for order-create
  const [composeStore, setComposeStore] = useState('');
  const [composeDescription, setComposeDescription] = useState('');
  const [composeStep, setComposeStep] = useState<'store' | 'description'>('store');

  // Compose state for store-add
  const [composeStoreName, setComposeStoreName] = useState('');

  const loadData = () => {
    try {
      setOrders(manager.listOrders({ limit: 50 }));
      setStores(manager.listStores());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const tabs: Tab[] = ['overview', 'orders', 'stores'];

  useInput((input, key) => {
    // Don't handle during text input modes
    if (mode === 'order-create' || mode === 'store-add') return;

    // Backspace to go back from detail view
    if (mode === 'order-detail' && key.backspace) {
      setMode('orders');
      setTab('orders');
      setDetailOrder(null);
      setDetailItems([]);
      return;
    }

    // In detail view, only allow backspace/q/escape
    if (mode === 'order-detail') {
      if (key.escape || input === 'q') {
        onClose();
        return;
      }
      return;
    }

    if (key.escape || input === 'q') {
      onClose();
      return;
    }

    // Tab switching with number keys
    if (input === '1') { setTab('overview'); setMode('overview'); setSelectedIndex(0); }
    else if (input === '2') { setTab('orders'); setMode('orders'); setSelectedIndex(0); }
    else if (input === '3') { setTab('stores'); setMode('stores'); setSelectedIndex(0); }

    // Tab switching with left/right
    if (key.leftArrow) {
      const idx = tabs.indexOf(tab);
      if (idx > 0) {
        const newTab = tabs[idx - 1];
        setTab(newTab);
        setMode(newTab);
        setSelectedIndex(0);
      }
    } else if (key.rightArrow) {
      const idx = tabs.indexOf(tab);
      if (idx < tabs.length - 1) {
        const newTab = tabs[idx + 1];
        setTab(newTab);
        setMode(newTab);
        setSelectedIndex(0);
      }
    }

    // List navigation
    if (key.upArrow || input === 'k') {
      setSelectedIndex((prev) => Math.max(0, prev - 1));
    } else if (key.downArrow || input === 'j') {
      setSelectedIndex((prev) => {
        const maxIndex = getListLength() - 1;
        return Math.min(Math.max(0, maxIndex), prev + 1);
      });
    }

    // Enter to view order details
    if (key.return && tab === 'orders' && orders.length > 0) {
      const selected = orders[selectedIndex];
      if (selected) {
        const detail = manager.getOrder(selected.id);
        if (detail) {
          setDetailOrder(detail.order);
          setDetailItems(detail.items);
          setMode('order-detail');
        } else {
          setStatusMessage('Order not found');
        }
      }
      return;
    }

    // Actions
    if (input === 'n' && (tab === 'overview' || tab === 'orders')) {
      setComposeStore('');
      setComposeDescription('');
      setComposeStep('store');
      setMode('order-create');
    } else if (input === 'c' && tab === 'orders' && orders.length > 0) {
      const selected = orders[selectedIndex];
      if (selected) {
        const result = manager.cancelOrder(selected.id);
        setStatusMessage(result.success ? result.message : `Error: ${result.message}`);
        loadData();
      }
    } else if (input === 'a' && tab === 'stores') {
      setComposeStoreName('');
      setMode('store-add');
    } else if (input === 'r') {
      loadData();
      setStatusMessage('Refreshed');
    }
  });

  const getListLength = (): number => {
    switch (tab) {
      case 'orders': return orders.length;
      case 'stores': return stores.length;
      default: return 0;
    }
  };

  // Tab bar
  const tabBar = (
    <Box marginBottom={1}>
      {tabs.map((t, i) => (
        <Box key={t} marginRight={1}>
          <Text
            color={tab === t ? 'blue' : 'gray'}
            bold={tab === t}
          >
            {i + 1}:{t}
          </Text>
        </Box>
      ))}
    </Box>
  );

  // Header
  const header = (
    <Box borderStyle="single" borderColor="blue" paddingX={1} marginBottom={1}>
      <Text bold color="blue">Orders</Text>
      <Text color="gray"> | </Text>
      <Text color="gray">
        {mode === 'order-create' ? 'esc:cancel' :
         mode === 'store-add' ? 'esc:cancel' :
         mode === 'order-detail' ? 'backspace:back q:close' :
         'q:close n:new-order a:add-store r:refresh'}
      </Text>
    </Box>
  );

  const statusBar2 = statusMessage ? (
    <Box marginBottom={1}><Text color="yellow">{statusMessage}</Text></Box>
  ) : null;

  const errorBar = error ? (
    <Box marginBottom={1}><Text color="red">Error: {error}</Text></Box>
  ) : null;

  // Order create compose
  if (mode === 'order-create') {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text bold>Create Order</Text>
          <Text> </Text>
          {composeStep === 'store' ? (
            <Box>
              <Text>Store: </Text>
              <TextInput
                value={composeStore}
                onChange={setComposeStore}
                onSubmit={() => {
                  if (composeStore.trim()) setComposeStep('description');
                }}
                placeholder="Store name"
              />
            </Box>
          ) : (
            <Box flexDirection="column">
              <Text>Store: {composeStore}</Text>
              <Box>
                <Text>Description: </Text>
                <TextInput
                  value={composeDescription}
                  onChange={setComposeDescription}
                  onSubmit={() => {
                    const desc = composeDescription.trim();
                    const result = manager.createOrder(
                      composeStore.trim(),
                      desc ? { description: desc } : undefined
                    );
                    setStatusMessage(result.success ? result.message : `Error: ${result.message}`);
                    setMode('orders');
                    setTab('orders');
                    loadData();
                  }}
                  placeholder="Optional description (submit empty to skip)"
                />
              </Box>
            </Box>
          )}
        </Box>
      </Box>
    );
  }

  // Store add compose
  if (mode === 'store-add') {
    return (
      <Box flexDirection="column">
        {header}
        <Box paddingX={1} flexDirection="column">
          <Text bold>Add Store</Text>
          <Text> </Text>
          <Box>
            <Text>Name: </Text>
            <TextInput
              value={composeStoreName}
              onChange={setComposeStoreName}
              onSubmit={() => {
                if (composeStoreName.trim()) {
                  const result = manager.addStore(composeStoreName.trim());
                  setStatusMessage(result.success ? result.message : `Error: ${result.message}`);
                  setMode('stores');
                  setTab('stores');
                  loadData();
                }
              }}
              placeholder="Store name"
            />
          </Box>
        </Box>
      </Box>
    );
  }

  // Order detail view
  if (mode === 'order-detail' && detailOrder) {
    const tracking = manager.getTracking(detailOrder.id);
    return (
      <Box flexDirection="column">
        {header}
        {statusBar2}
        {errorBar}
        <Box flexDirection="column" paddingX={1}>
          <Text bold>Order Details</Text>
          <Text> </Text>
          <Text>Order #:     {detailOrder.orderNumber || detailOrder.id}</Text>
          <Text>Store:       {detailOrder.storeName}</Text>
          <Text>Status:      <Text color={statusColor(detailOrder.status)}>{detailOrder.status}</Text></Text>
          {detailOrder.description && <Text>Description: {detailOrder.description}</Text>}
          <Text>Total:       {formatCurrency(detailOrder.totalAmount, detailOrder.currency)}</Text>
          {detailOrder.shippingAddress && <Text>Ship to:     {detailOrder.shippingAddress}</Text>}
          {detailOrder.paymentMethod && <Text>Payment:     {detailOrder.paymentMethod}</Text>}
          {detailOrder.notes && <Text>Notes:       {detailOrder.notes}</Text>}
          <Text>Created:     {formatRelativeTime(detailOrder.createdAt)}</Text>
          <Text>Updated:     {formatRelativeTime(detailOrder.updatedAt)}</Text>
          {tracking && tracking.trackingNumber && (
            <>
              <Text> </Text>
              <Text bold>Tracking</Text>
              <Text>Number:      {tracking.trackingNumber}</Text>
              {tracking.trackingUrl && <Text>URL:         {tracking.trackingUrl}</Text>}
            </>
          )}
          <Text> </Text>
          <Text bold>Items ({detailItems.length})</Text>
          {detailItems.length === 0 ? (
            <Text color="gray">No items in this order.</Text>
          ) : (
            detailItems.map((item) => (
              <Box key={item.id} flexDirection="column" marginTop={0}>
                <Box>
                  <Text>  - </Text>
                  <Text bold>{item.name}</Text>
                  <Text color="gray"> x{item.quantity}</Text>
                  <Text> @ {formatCurrency(item.unitPrice, detailOrder.currency)}</Text>
                  <Text color="gray"> = {formatCurrency(item.totalPrice, detailOrder.currency)}</Text>
                </Box>
                {item.description && (
                  <Box paddingLeft={4}>
                    <Text color="gray">{item.description}</Text>
                  </Box>
                )}
                {item.sku && (
                  <Box paddingLeft={4}>
                    <Text color="gray">SKU: {item.sku}</Text>
                  </Box>
                )}
                {item.status && (
                  <Box paddingLeft={4}>
                    <Text color={statusColor(item.status)}>Status: {item.status}</Text>
                  </Box>
                )}
              </Box>
            ))
          )}
          <Text> </Text>
          <Text color="gray">Press backspace to go back</Text>
        </Box>
      </Box>
    );
  }

  // Overview tab
  if (tab === 'overview') {
    const statusCounts: Record<string, number> = {};
    for (const order of orders) {
      statusCounts[order.status] = (statusCounts[order.status] || 0) + 1;
    }
    const recentOrders = orders.slice(0, 5);

    return (
      <Box flexDirection="column">
        {header}
        {tabBar}
        {statusBar2}
        {errorBar}
        <Box flexDirection="column" paddingX={1}>
          <Text bold>Orders Overview</Text>
          <Text> </Text>
          <Text>Total orders: {orders.length}</Text>
          <Text>Total stores: {stores.length}</Text>
          <Text> </Text>
          <Text bold>By Status</Text>
          {Object.keys(statusCounts).length === 0 ? (
            <Text color="gray">No orders yet.</Text>
          ) : (
            Object.entries(statusCounts).map(([st, count]) => (
              <Box key={st}>
                <Text>  </Text>
                <Text color={statusColor(st)}>{st}</Text>
                <Text>: {count}</Text>
              </Box>
            ))
          )}
          <Text> </Text>
          <Text bold>Recent Activity</Text>
          {recentOrders.length === 0 ? (
            <Text color="gray">No recent orders.</Text>
          ) : (
            recentOrders.map((order) => (
              <Box key={order.id}>
                <Text>  </Text>
                <Text color={statusColor(order.status)}>
                  [{order.status}]
                </Text>
                <Text> {order.storeName}</Text>
                {order.orderNumber && <Text color="gray"> #{order.orderNumber}</Text>}
                <Text color="gray"> | {formatCurrency(order.totalAmount, order.currency)}</Text>
                <Text color="gray"> | {formatRelativeTime(order.updatedAt)}</Text>
              </Box>
            ))
          )}
          <Text> </Text>
          <Text color="gray">Press 'n' to create a new order</Text>
        </Box>
      </Box>
    );
  }

  // Orders tab
  if (tab === 'orders') {
    return (
      <Box flexDirection="column">
        {header}
        {tabBar}
        {statusBar2}
        {errorBar}
        {orders.length === 0 ? (
          <Box paddingX={1}><Text color="gray">No orders. Press 'n' to create an order.</Text></Box>
        ) : (
          <Box flexDirection="column" paddingX={1}>
            {orders.map((order, i) => (
              <Box key={order.id}>
                <Text color={i === selectedIndex ? 'blue' : undefined}>
                  {i === selectedIndex ? '▸ ' : '  '}
                </Text>
                <Text color={statusColor(order.status)}>
                  [{order.status}]
                </Text>
                <Text> {order.storeName}</Text>
                {order.orderNumber && <Text color="gray"> #{order.orderNumber}</Text>}
                {order.description && <Text color="gray"> - {order.description}</Text>}
                <Text color="gray"> | {formatCurrency(order.totalAmount, order.currency)}</Text>
                <Text color="gray"> | {order.itemCount} item{order.itemCount !== 1 ? 's' : ''}</Text>
                <Text color="gray"> | {formatRelativeTime(order.updatedAt)}</Text>
              </Box>
            ))}
            <Text> </Text>
            <Text color="gray">enter:details n:new c:cancel j/k:navigate</Text>
          </Box>
        )}
      </Box>
    );
  }

  // Stores tab
  if (tab === 'stores') {
    return (
      <Box flexDirection="column">
        {header}
        {tabBar}
        {statusBar2}
        {errorBar}
        {stores.length === 0 ? (
          <Box paddingX={1}><Text color="gray">No stores. Press 'a' to add a store.</Text></Box>
        ) : (
          <Box flexDirection="column" paddingX={1}>
            {stores.map((store, i) => (
              <Box key={store.id}>
                <Text color={i === selectedIndex ? 'blue' : undefined}>
                  {i === selectedIndex ? '▸ ' : '  '}
                </Text>
                <Text bold={i === selectedIndex}>{store.name}</Text>
                {store.category && <Text color="gray"> ({store.category})</Text>}
                <Text color="gray"> | {store.orderCount} order{store.orderCount !== 1 ? 's' : ''}</Text>
                {store.url && <Text color="gray"> | {store.url}</Text>}
                <Text color="gray"> | last: {formatRelativeTime(store.lastOrderAt)}</Text>
              </Box>
            ))}
            <Text> </Text>
            <Text color="gray">a:add-store j/k:navigate</Text>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {header}
      <Text color="gray">Loading...</Text>
    </Box>
  );
}
