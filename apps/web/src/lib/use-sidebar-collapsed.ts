'use client';

import { useSyncExternalStore } from 'react';
import { readSidebarCollapsed, writeSidebarCollapsed } from './preferences';

const listeners = new Set<() => void>();
// Remembers the choice for this session even when storage rejects the write.
let inMemory: boolean | undefined;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

const getSnapshot = () => inMemory ?? readSidebarCollapsed();
// The server cannot read localStorage, so the first paint is always expanded.
const getServerSnapshot = () => false;

export function useSidebarCollapsed(): [boolean, (value: boolean) => void] {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setCollapsed = (value: boolean) => {
    inMemory = value;
    writeSidebarCollapsed(value);
    listeners.forEach((listener) => listener());
  };
  return [collapsed, setCollapsed];
}
