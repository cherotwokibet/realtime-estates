'use client';
import { createContext, useContext } from 'react';
export const ClearRecipient = createContext<() => void>(() => {});
export const useRecipientClear = () => useContext(ClearRecipient);
