import React, { useEffect, useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import type { MobileReferenceConfig, MobileReferenceItem } from './reference-catalogue';
import {
  loadMobilePublishedVideo,
  openMobilePublishedVideo,
  type MobileVideoResult,
} from './published-video';
/** Parent key includes company/origin/listing/revision/version; stale requests cannot populate another detail. */
export default function PublishedListingVideo({
  config,
  property,
}: {
  config: MobileReferenceConfig;
  property: MobileReferenceItem['property'];
}) {
  const [result, setResult] = useState<MobileVideoResult | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setResult(null);
    setFailed(false);
    void loadMobilePublishedVideo(config, property, controller.signal).then((value) => {
      if (active && !controller.signal.aborted) setResult(value);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [config, property]);
  if (result?.status === 'off') return null;
  return (
    <View>
      <Text accessibilityRole="header">Property video</Text>
      {result?.status === 'ready' ? (
        result.video ? (
          <>
            <Text>{result.video.title}</Text>
            <Text>Opening this link visits an external video provider.</Text>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel={`Open video on ${result.video.provider === 'youtube' ? 'YouTube' : 'Vimeo'}`}
              style={{ minHeight: 48, padding: 12, borderWidth: 1, marginVertical: 8 }}
              onPress={() => {
                setFailed(false);
                void openMobilePublishedVideo(result, Linking.openURL).catch(() => setFailed(true));
              }}
            >
              <Text>Open on {result.video.provider === 'youtube' ? 'YouTube' : 'Vimeo'}</Text>
            </Pressable>
          </>
        ) : (
          <Text>No video supplied for this approved revision.</Text>
        )
      ) : (
        <Text>{result === null ? 'Loading video details…' : 'Video details are unavailable.'}</Text>
      )}
      {failed && <Text accessibilityRole="alert">The external video could not be opened.</Text>}
    </View>
  );
}
