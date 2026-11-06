import React, { useEffect, useState } from 'react';
import { Image, Text, View } from 'react-native';
import { fetch as expoFetch } from 'expo/fetch';
import { digest, CryptoDigestAlgorithm } from 'expo-crypto';
import type { MobileReferenceConfig, MobileReferenceItem } from './reference-catalogue';
import { loadMobilePublishedFloorPlan, type MobileFloorPlanResult } from './published-floor-plan';
const platform = Object.freeze({
  fetch: expoFetch as unknown as typeof fetch,
  digest: (data: Uint8Array<ArrayBuffer>) => digest(CryptoDigestAlgorithm.SHA256, data),
});
/** Parent scope key includes company, origin, listing, revision and approved version. */
export default function PublishedFloorPlan({
  config,
  property,
}: {
  config: MobileReferenceConfig;
  property: MobileReferenceItem['property'];
}) {
  const [result, setResult] = useState<MobileFloorPlanResult | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setResult(null);
    void loadMobilePublishedFloorPlan(config, property, controller.signal, platform).then(
      (value) => {
        if (active && !controller.signal.aborted) setResult(value);
      },
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [config, property]);
  if (result?.status === 'off') return null;
  const image = result?.status === 'ready' ? result.image : null;
  return (
    <View>
      <Text accessibilityRole="header">Floor plan</Text>
      {result === null ? (
        <Text accessibilityRole="alert">Loading floor plan…</Text>
      ) : result.status === 'unavailable' ? (
        <Text accessibilityRole="alert">
          Floor plan unavailable. Refresh the property to check current details.
        </Text>
      ) : image ? (
        <Image
          source={{ uri: image.uri }}
          accessibilityLabel="Approved property floor plan"
          resizeMode="contain"
          style={{ width: '100%', aspectRatio: image.width / image.height }}
          onError={() => setResult({ status: 'unavailable' })}
        />
      ) : (
        <Text>No floor plan supplied for this approved revision.</Text>
      )}
    </View>
  );
}
