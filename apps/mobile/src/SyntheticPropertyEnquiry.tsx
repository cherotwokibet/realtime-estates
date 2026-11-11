import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, SafeAreaView, ScrollView, Text, View } from 'react-native';
import { fetch as expoFetch } from 'expo/fetch';
import { randomUUID } from 'expo-crypto';
import type { PublicEnquiryAttempt } from '@realtor/api-client';
import type { MobileReferenceConfig, MobileReferenceItem } from './reference-catalogue';
import type { createReferenceCatalogueStyles } from './reference-theme';
import { CatalogueButton } from './ReferenceCatalogueButton';
import { prepareSyntheticMobileEnquiry } from './property-enquiry';

type Draft = {
  listingId: string;
  title: string;
  question: 'availability' | 'viewing';
  attempt: PublicEnquiryAttempt | null;
};
export function SyntheticPropertyEnquiry({
  config,
  selected,
  styles: s,
}: {
  config: Extract<MobileReferenceConfig, { mode: 'synthetic-reference-public-v1' }>;
  selected: MobileReferenceItem | null;
  styles: ReturnType<typeof createReferenceCatalogueStyles>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [, refresh] = useState(0);
  const active = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.abort();
    };
  }, []);
  const status = draft?.attempt?.state.status;
  const locked = status === 'sending' || status === 'uncertain' || status === 'received';
  if (!config.customerMode) return null;

  async function submit() {
    if (!draft || active.current || !acknowledged) return;
    let attempt = draft.attempt;
    try {
      if (!attempt || attempt.state.status === 'rejected') {
        if (selected?.property.id !== draft.listingId) {
          setFeedback('Reload this property before sending an enquiry.');
          return;
        }
        attempt = prepareSyntheticMobileEnquiry(
          config,
          draft.listingId,
          draft.question,
          randomUUID(),
          expoFetch as unknown as typeof fetch,
        );
        setDraft({ ...draft, attempt });
      }
      const controller = new AbortController();
      active.current = controller;
      const result =
        attempt.state.status === 'uncertain'
          ? attempt.retryOriginal({ signal: controller.signal })
          : attempt.submit({ signal: controller.signal });
      refresh((value) => value + 1);
      await result;
      if (mounted.current)
        setFeedback(
          draft.question === 'viewing'
            ? 'Your viewing request was received. A realtor can follow up to arrange a time.'
            : 'Your synthetic enquiry was received.',
        );
    } catch {
      if (mounted.current)
        setFeedback(
          attempt?.state.status === 'uncertain'
            ? 'The result is unconfirmed. Retry the original enquiry to check its receipt.'
            : 'The enquiry could not be saved. Reload the property and try again.',
        );
    } finally {
      active.current = null;
      if (mounted.current) refresh((value) => value + 1);
    }
  }
  function close() {
    active.current?.abort();
    setOpen(false);
  }
  function begin(question: Draft['question']) {
    if (!selected || locked) return;
    setDraft({
      listingId: selected.property.id,
      title: selected.property.title,
      question,
      attempt: null,
    });
    setAcknowledged(false);
    setFeedback('');
    setOpen(true);
  }
  const viewing = draft?.question === 'viewing';
  return (
    <View>
      {locked ? (
        <CatalogueButton
          label={viewing ? 'Resume viewing request' : 'Resume property enquiry'}
          onPress={() => setOpen(true)}
          styles={s}
        />
      ) : (
        selected && (
          <>
            <CatalogueButton
              label="Ask about availability"
              onPress={() => begin('availability')}
              styles={s}
            />
            <CatalogueButton
              label="Request a viewing"
              onPress={() => begin('viewing')}
              styles={s}
            />
          </>
        )
      )}
      <Modal visible={open} animationType="slide" onRequestClose={close}>
        <SafeAreaView style={s.root}>
          <ScrollView contentContainerStyle={s.page}>
            <Text accessibilityRole="header" style={s.title}>
              {viewing ? 'Request a viewing' : 'Property enquiry'}
            </Text>
            <Text style={s.heading}>{draft?.title}</Text>
            <Text style={s.copy}>
              This preview uses fictional contact details and stores the enquiry in the local test
              database.
            </Text>
            {viewing && <Text style={s.copy}>A realtor can follow up to propose a time.</Text>}
            <Text style={s.copy}>Synthetic Mobile Customer · mobile-customer@example.invalid</Text>
            {!locked && (
              <>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: acknowledged }}
                  onPress={() => setAcknowledged(!acknowledged)}
                  style={s.button}
                >
                  <Text style={s.buttonText}>
                    {acknowledged ? '☑' : '☐'} I agree to save this fictional enquiry in the local
                    preview.
                  </Text>
                </Pressable>
              </>
            )}
            {feedback !== '' && (
              <Text accessibilityLiveRegion="polite" style={s.copy}>
                {feedback}
              </Text>
            )}
            {status === 'sending' && (
              <Text accessibilityLiveRegion="polite" style={s.copy}>
                Saving the enquiry…
              </Text>
            )}
            {status !== 'received' && (
              <CatalogueButton
                label={
                  status === 'uncertain'
                    ? 'Retry original request'
                    : viewing
                      ? 'Send viewing request'
                      : 'Send synthetic enquiry'
                }
                onPress={() => void submit()}
                disabled={!acknowledged || status === 'sending'}
                styles={s}
              />
            )}
            {status === 'received' && (
              <Text selectable style={s.copy}>
                Reference {draft?.attempt?.state.receipt?.id}
              </Text>
            )}
            {status === 'received' && (
              <CatalogueButton
                label="Done"
                onPress={() => {
                  setOpen(false);
                  setDraft(null);
                  setAcknowledged(false);
                  setFeedback('');
                }}
                styles={s}
              />
            )}
            <CatalogueButton label="Back to properties" onPress={close} styles={s} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
