import React, { useEffect, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { fetch as expoFetch } from 'expo/fetch';
import type { MobileReferenceConfig, MobileReferenceItem } from './reference-catalogue';
import { loadMobilePhoto, type MobilePhotoResult } from './published-photos';
/** One visible owned-byte image. No external Image URL or persistent cache. */
export default function PublishedPhotoGallery({
  config,
  property,
}: {
  config: MobileReferenceConfig;
  property: MobileReferenceItem['property'];
}) {
  const [index, setIndex] = useState(0),
    [state, setState] = useState<{ key: string; result: MobilePhotoResult } | null>(null);
  const key = JSON.stringify([config, property.id, property.revision, property.photos, index]);
  useEffect(() => {
    const c = new AbortController();
    let live = true;
    setState(null);
    void loadMobilePhoto(
      config,
      property,
      index,
      c.signal,
      expoFetch as unknown as typeof fetch,
    ).then((result) => {
      if (live && !c.signal.aborted) setState({ key, result });
    });
    return () => {
      live = false;
      c.abort();
    };
  }, [config, property, index, key]);
  const result = state?.key === key ? state.result : null;
  if (result?.status === 'off') return null;
  const count = property.photos.length;
  return (
    <View accessibilityLabel="Property photos">
      <Text accessibilityRole="header">Property photos</Text>
      {result?.status === 'ready' ? (
        <Image
          key={key}
          source={{ uri: result.uri }}
          accessibilityLabel={result.alt}
          resizeMode="contain"
          style={{ width: '100%', aspectRatio: 1.5 }}
          onError={() =>
            setState((old) => (old?.key === key ? { key, result: { status: 'unavailable' } } : old))
          }
        />
      ) : result?.status === 'empty' ? (
        <Text>No photos supplied for this approved revision.</Text>
      ) : result?.status === 'unavailable' ? (
        <Text accessibilityRole="alert">
          Property photo unavailable. Refresh the property to check current details.
        </Text>
      ) : (
        <Text accessibilityLiveRegion="polite">Loading property photo…</Text>
      )}
      {count > 0 && (
        <>
          <Text>
            Photo {index + 1} of {count}
          </Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous property photo"
              disabled={index === 0}
              onPress={() => setIndex((i) => Math.max(0, i - 1))}
              style={{ minHeight: 48, padding: 12, borderWidth: 1, opacity: index === 0 ? 0.5 : 1 }}
            >
              <Text>Previous</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next property photo"
              disabled={index >= count - 1}
              onPress={() => setIndex((i) => Math.min(count - 1, i + 1))}
              style={{
                minHeight: 48,
                padding: 12,
                borderWidth: 1,
                opacity: index >= count - 1 ? 0.5 : 1,
              }}
            >
              <Text>Next</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}
