'use client';
import { PROPERTY_TYPES, RENTAL_PERIODS } from '@realtor/domain';
import type { Dispatch, SetStateAction } from 'react';
import type { DraftForm, ChargeForm } from '../lib/editor-model.ts';
/** Staff-only property fields. Public location labels are supplied solely by explicit reference IDs. */
export default function ReferencePropertyFields({
  form,
  setForm,
  disabled,
}: {
  form: DraftForm;
  setForm: Dispatch<SetStateAction<DraftForm>>;
  disabled: boolean;
}) {
  const update = <K extends keyof DraftForm>(key: K, value: DraftForm[K]) =>
    setForm((old) => ({ ...old, [key]: value }));
  const charge = (index: number, patch: Partial<ChargeForm>) =>
    update(
      'charges',
      form.charges.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  return (
    <fieldset disabled={disabled}>
      <legend>Property facts and exact costs</legend>
      {(
        [
          'title',
          'description',
          'privateAddress',
          'bedrooms',
          'privateBathrooms',
          'sharedBathrooms',
          'latitude',
          'longitude',
        ] as const
      ).map((key) => (
        <label className="draft-field" key={key}>
          {
            {
              title: 'Title',
              description: 'Description',
              privateAddress: 'Private address (staff only)',
              bedrooms: 'Bedrooms',
              privateBathrooms: 'Private bathrooms',
              sharedBathrooms: 'Shared bathrooms',
              latitude: 'Latitude',
              longitude: 'Longitude',
            }[key]
          }
          {key === 'description' ? (
            <textarea
              value={form[key]}
              maxLength={10000}
              onChange={(e) => update(key, e.target.value)}
            />
          ) : (
            <input
              value={form[key]}
              maxLength={key === 'privateAddress' ? 1000 : 320}
              onChange={(e) => update(key, e.target.value)}
            />
          )}
        </label>
      ))}
      <label className="draft-field">
        Property type
        <select value={form.propertyType} onChange={(e) => update('propertyType', e.target.value)}>
          <option value="">Unknown type</option>
          {PROPERTY_TYPES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label className="draft-field">
        Purpose
        <select value={form.purpose} onChange={(e) => update('purpose', e.target.value)}>
          <option value="">Unknown purpose</option>
          <option value="rent">Rent</option>
          <option value="sale">Sale</option>
        </select>
      </label>
      <label className="draft-field">
        Base price (KES; blank is unknown)
        <input
          inputMode="decimal"
          value={form.amount}
          onChange={(e) => update('amount', e.target.value)}
        />
      </label>
      <label className="draft-field">
        Rental period
        <select value={form.rentPeriod} onChange={(e) => update('rentPeriod', e.target.value)}>
          <option value="">Unknown / not applicable</option>
          {RENTAL_PERIODS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label className="draft-field">
        Public location precision
        <select
          value={form.publicPrecision}
          onChange={(e) => update('publicPrecision', e.target.value)}
        >
          <option value="area">Area</option>
          <option value="exact">Exact</option>
        </select>
      </label>
      <label className="draft-field">
        Cost declaration
        <select
          value={form.declaration}
          onChange={(e) => update('declaration', e.target.value as DraftForm['declaration'])}
        >
          {(['not_declared', 'incomplete', 'complete'] as const).map((value) => (
            <option key={value} value={value}>
              {value.replaceAll('_', ' ')}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>Additional fees and refundable deposits</legend>
        {form.charges.map((row, index) => (
          <div key={row.id}>
            <label>
              Charge name
              <input
                value={row.name}
                maxLength={160}
                onChange={(e) => charge(index, { name: e.target.value })}
              />
            </label>
            <label>
              Amount status
              <select
                value={row.amountStatus}
                onChange={(e) =>
                  charge(index, { amountStatus: e.target.value as ChargeForm['amountStatus'] })
                }
              >
                <option value="known">Known</option>
                <option value="quote_required">Quote required</option>
              </select>
            </label>
            <label>
              KES amount
              <input
                inputMode="decimal"
                disabled={row.amountStatus === 'quote_required'}
                value={row.amount}
                onChange={(e) => charge(index, { amount: e.target.value })}
              />
            </label>
            <label>
              Timing
              <select
                value={row.timing}
                onChange={(e) => charge(index, { timing: e.target.value as ChargeForm['timing'] })}
              >
                <option value="one_off">One off</option>
                <option value="per_rental_period">Per rental period</option>
              </select>
            </label>
            <label>
              Classification
              <select
                value={row.classification}
                onChange={(e) =>
                  charge(index, { classification: e.target.value as ChargeForm['classification'] })
                }
              >
                <option value="fee">Fee</option>
                <option value="refundable_deposit">Refundable deposit</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={row.mandatory}
                onChange={(e) => charge(index, { mandatory: e.target.checked })}
              />
              Mandatory
            </label>
            <button
              type="button"
              onClick={() =>
                update(
                  'charges',
                  form.charges.filter((_, i) => i !== index),
                )
              }
            >
              Remove charge
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={form.charges.length >= 32}
          onClick={() =>
            update('charges', [
              ...form.charges,
              {
                id: crypto.randomUUID(),
                name: '',
                amountStatus: 'quote_required',
                amount: '',
                timing: 'one_off',
                classification: 'fee',
                mandatory: false,
              },
            ])
          }
        >
          Add charge
        </button>
      </fieldset>
    </fieldset>
  );
}
