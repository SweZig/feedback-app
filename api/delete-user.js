export async function removeUser(userId) {
  try {
    const response = await fetch('/api/delete-user', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Kunde inte ta bort användaren');
    }

    return { success: true };
  } catch (err) {
    console.error('[removeUser]', err);
    throw err;
  }
}