import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { activatePriceBook, type PriceBook } from '@/lib/priceBooks';
import { supabase } from '@/lib/supabase';
import { colors, radii, spacing, type as typography } from '@/lib/theme';

// New-job modal: job name + trade/price-book picker, lands directly in the
// capture session (SPEC.md - Mobile UI/UX - Navigation and structure). The
// job name is stored in jobs.client_name — the schema's display field.

function defaultBookId(books: PriceBook[]): string | null {
  const ownedActive = books.find((book) => book.user_id !== null && book.is_active);
  if (ownedActive) {
    return ownedActive.id;
  }
  const activeTemplate = books.find((book) => book.is_template && book.is_active);
  if (activeTemplate) {
    return activeTemplate.id;
  }
  return books[0]?.id ?? null;
}

export default function NewJobScreen() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [books, setBooks] = useState<PriceBook[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        if (!cancelled) {
          setError('You are signed out. Close this and sign in again.');
          setBooks([]);
        }
        return;
      }
      const { data, error: queryError } = await supabase
        .from('price_books')
        .select('*')
        .or(`is_template.eq.true,user_id.eq.${session.user.id}`)
        .order('name');
      if (cancelled) {
        return;
      }
      if (queryError) {
        setError(`Couldn’t load price books: ${queryError.message}`);
        setBooks([]);
        return;
      }
      const rows = (data ?? []) as PriceBook[];
      setUserId(session.user.id);
      setBooks(rows);
      setSelectedId(defaultBookId(rows));
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedBook = books?.find((book) => book.id === selectedId) ?? null;
  const canSubmit = name.trim().length > 0 && selectedBook !== null && userId !== null && !submitting;

  const startCapture = async () => {
    if (!selectedBook || userId === null) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await activatePriceBook(selectedBook, userId);
      const trimmedAddress = address.trim();
      const { data, error: insertError } = await supabase
        .from('jobs')
        .insert({
          user_id: userId,
          client_name: name.trim(),
          address: trimmedAddress === '' ? null : trimmedAddress,
          trade: selectedBook.trade,
          status: 'open',
        })
        .select('id')
        .single();
      if (insertError || !data) {
        throw new Error(insertError?.message ?? 'Job insert returned no row.');
      }
      // replace: the modal must not linger behind the capture session.
      router.replace(`/capture/${(data as { id: string }).id}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setSubmitting(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.label}>Job name</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        placeholder="e.g. Rivera bedroom repaint"
        placeholderTextColor={colors.textMuted}
        autoFocus
        returnKeyType="next"
        accessibilityLabel="Job name"
      />

      <Text style={styles.label}>Address (optional)</Text>
      <TextInput
        style={styles.input}
        value={address}
        onChangeText={setAddress}
        placeholder="Street, city"
        placeholderTextColor={colors.textMuted}
        returnKeyType="done"
        accessibilityLabel="Address"
      />

      <Text style={styles.label}>Price book</Text>
      {books === null ? (
        <ActivityIndicator color={colors.primary} style={styles.booksLoading} />
      ) : (
        <View style={styles.bookList}>
          {books.map((book) => {
            const selected = book.id === selectedId;
            return (
              <Pressable
                key={book.id}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                style={({ pressed }) => [
                  styles.bookRow,
                  selected && styles.bookRowSelected,
                  pressed && styles.bookRowPressed,
                ]}
                onPress={() => setSelectedId(book.id)}
              >
                <Ionicons
                  name={selected ? 'radio-button-on' : 'radio-button-off'}
                  size={22}
                  color={selected ? colors.primary : colors.textMuted}
                />
                <View style={styles.bookInfo}>
                  <Text style={styles.bookName}>{book.name}</Text>
                  <Text style={styles.bookTrade}>
                    {book.trade}
                    {book.is_template ? ' · template' : ''}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {error !== null ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit }}
        disabled={!canSubmit}
        style={({ pressed }) => [
          styles.submit,
          pressed && canSubmit && styles.submitPressed,
          !canSubmit && styles.submitDisabled,
        ]}
        onPress={() => {
          void startCapture();
        }}
      >
        {submitting ? (
          <ActivityIndicator size="small" color={colors.textOnPrimary} />
        ) : (
          <Ionicons name="camera-outline" size={20} color={colors.textOnPrimary} />
        )}
        <Text style={styles.submitLabel}>{submitting ? 'Starting…' : 'Start capture'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  label: {
    ...typography.captionBold,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    marginTop: spacing.lg,
  },
  input: {
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  booksLoading: { marginVertical: spacing.lg },
  bookList: { gap: spacing.sm },
  bookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  bookRowSelected: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  bookRowPressed: { opacity: 0.7 },
  bookInfo: { flex: 1, gap: 2 },
  bookName: { ...typography.bodyBold, color: colors.textPrimary },
  bookTrade: { ...typography.caption, color: colors.textSecondary },
  error: {
    ...typography.caption,
    color: colors.danger,
    backgroundColor: colors.dangerLight,
    borderRadius: radii.sm,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  submit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.md,
    marginTop: spacing.xl,
  },
  submitPressed: { backgroundColor: colors.primaryDark },
  submitDisabled: { opacity: 0.5 },
  submitLabel: { ...typography.bodyBold, color: colors.textOnPrimary },
});
