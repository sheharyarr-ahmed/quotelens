// Price-book activation for the new-job flow. Backend pricing resolution
// picks the is_active book, preferring the user's own over templates
// (SPEC.md - Pricing model). Template rows are read-only under RLS, so this
// only ever mutates user-owned rows and clones a template when picking it
// requires flipping its is_active flag.

import { supabase } from '@/lib/supabase';

export interface PriceBook {
  id: string;
  user_id: string | null;
  name: string;
  trade: string;
  is_template: boolean;
  is_active: boolean;
}

interface PriceBookItemFields {
  name: string;
  description: string | null;
  unit: string;
  unit_price_cents: number;
}

async function setOwnedBookActive(bookId: string, bookName: string): Promise<void> {
  const { error } = await supabase
    .from('price_books')
    .update({ is_active: true })
    .eq('id', bookId);
  if (error) {
    throw new Error(`Could not activate price book "${bookName}": ${error.message}`);
  }
}

async function cloneTemplateForUser(template: PriceBook, userId: string): Promise<void> {
  const { data: clone, error: cloneError } = await supabase
    .from('price_books')
    .insert({
      user_id: userId,
      name: template.name,
      trade: template.trade,
      is_template: false,
      is_active: true,
    })
    .select('id')
    .single();
  if (cloneError || !clone) {
    throw new Error(
      `Could not copy the "${template.name}" template: ${cloneError?.message ?? 'no row returned'}`,
    );
  }
  const cloneId = (clone as { id: string }).id;

  const { data: items, error: itemsError } = await supabase
    .from('price_book_items')
    .select('name, description, unit, unit_price_cents')
    .eq('price_book_id', template.id);
  if (itemsError) {
    throw new Error(`Could not read items of "${template.name}": ${itemsError.message}`);
  }
  const rows = (items ?? []) as PriceBookItemFields[];
  if (rows.length > 0) {
    const { error: copyError } = await supabase
      .from('price_book_items')
      .insert(rows.map((item) => ({ ...item, price_book_id: cloneId })));
    if (copyError) {
      throw new Error(`Could not copy items of "${template.name}": ${copyError.message}`);
    }
  }
}

/**
 * Make `book` the effective price book for `userId`.
 *
 * Sequential steps, all under RLS:
 * 1. Deactivate every owned active book, so at most one owned book can win.
 * 2. Owned book: flip it active.
 *    Globally active template (painting): nothing more — with no owned
 *    active book, the template now wins backend resolution.
 *    Inactive template (hvac/landscaping): clone it for the user — reuse an
 *    owned book with the same name when one exists, otherwise copy the book
 *    row plus all its items. Step 1 already guarantees the result is the
 *    only active owned book.
 */
export async function activatePriceBook(book: PriceBook, userId: string): Promise<void> {
  const { error: deactivateError } = await supabase
    .from('price_books')
    .update({ is_active: false })
    .eq('user_id', userId)
    .eq('is_active', true);
  if (deactivateError) {
    throw new Error(`Could not deactivate the current price book: ${deactivateError.message}`);
  }

  if (!book.is_template) {
    await setOwnedBookActive(book.id, book.name);
    return;
  }

  if (book.is_active) {
    return;
  }

  const { data: existing, error: existingError } = await supabase
    .from('price_books')
    .select('id')
    .eq('user_id', userId)
    .eq('name', book.name)
    .limit(1)
    .maybeSingle();
  if (existingError) {
    throw new Error(`Could not look up your copy of "${book.name}": ${existingError.message}`);
  }
  if (existing) {
    await setOwnedBookActive((existing as { id: string }).id, book.name);
    return;
  }

  await cloneTemplateForUser(book, userId);
}
