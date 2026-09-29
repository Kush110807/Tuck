import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, minimumTouchSize, radii, space } from '../theme/tokens';

export function AuthLandingScreen({
  onContinueEmail,
  onContinueLocal,
  busy,
  message,
}: Readonly<{
  onContinueEmail(email: string): Promise<void>;
  onContinueLocal(): void;
  busy: boolean;
  message: string | null;
}>) {
  const [email, setEmail] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const submit = async () => {
    setLocalError(null);
    try { await onContinueEmail(email); } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Could not send the sign-in link.');
    }
  };
  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <Text style={styles.brand}>Tuck</Text>
        <Text style={styles.title}>Your things. Everywhere.</Text>
        <Text style={styles.body}>Sign in to keep the same Tuck library on Android and your laptop.</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          placeholder="you@example.com"
          placeholderTextColor={colors.tertiaryText}
          style={styles.input}
          editable={!busy}
          accessibilityLabel="Email address"
        />
        <Pressable style={({ pressed }) => [styles.primary, pressed && styles.primaryPressed]} onPress={() => void submit()} disabled={busy}>
          {busy ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.primaryText}>Continue with email</Text>}
        </Pressable>
        {message ? <Text style={styles.info}>{message}</Text> : null}
        {localError ? <Text style={styles.error}>{localError}</Text> : null}
        <View style={styles.dividerRow}><View style={styles.line} /><Text style={styles.or}>or</Text><View style={styles.line} /></View>
        <Pressable style={styles.local} onPress={onContinueLocal} disabled={busy}>
          <Text style={styles.localText}>Continue locally</Text>
        </Pressable>
        <Text style={styles.footnote}>Local mode stays on this device and works without an account.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', padding: space.xl },
  card: { width: '100%', maxWidth: 440, alignSelf: 'center', backgroundColor: colors.surface, borderRadius: radii.sheet, padding: space.xxl, borderWidth: 1, borderColor: colors.border },
  brand: { fontSize: 32, fontWeight: '800', color: colors.primary, letterSpacing: -1 },
  title: { marginTop: space.sm, fontSize: 24, fontWeight: '700', color: colors.text },
  body: { marginTop: space.sm, fontSize: 15, lineHeight: 22, color: colors.secondaryText },
  input: { minHeight: 52, marginTop: space.xl, borderWidth: 1, borderColor: colors.border, borderRadius: radii.control, backgroundColor: colors.background, paddingHorizontal: space.lg, color: colors.text, fontSize: 16 },
  primary: { minHeight: 52, marginTop: space.md, borderRadius: radii.control, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryPressed: { backgroundColor: colors.primaryPressed },
  primaryText: { color: colors.surface, fontWeight: '700', fontSize: 16 },
  info: { marginTop: space.md, color: colors.primary, lineHeight: 20 },
  error: { marginTop: space.md, color: colors.error, lineHeight: 20 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginVertical: space.xl },
  line: { height: 1, backgroundColor: colors.divider, flex: 1 },
  or: { color: colors.tertiaryText },
  local: { minHeight: minimumTouchSize, alignItems: 'center', justifyContent: 'center' },
  localText: { color: colors.primary, fontWeight: '700' },
  footnote: { marginTop: space.sm, textAlign: 'center', color: colors.tertiaryText, fontSize: 12, lineHeight: 17 },
});
