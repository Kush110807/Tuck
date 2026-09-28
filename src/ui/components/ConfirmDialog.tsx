import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ConfirmDialogProps } from '../../contracts';
import { colors, radii, space } from '../../theme/tokens';
import { ActionButton } from './ActionButton';

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  destructive,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close dialog"
          onPress={onCancel}
          style={StyleSheet.absoluteFill}
        />
        <View
          accessibilityRole="alert"
          accessibilityViewIsModal
          style={styles.dialog}
        >
          <Text accessibilityRole="header" style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            <ActionButton label="Cancel" onPress={onCancel} variant="secondary" style={styles.action} />
            <ActionButton
              label={confirmLabel}
              onPress={onConfirm}
              variant={destructive ? 'danger' : 'primary'}
              style={styles.action}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(31, 41, 55, 0.42)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
  },
  dialog: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: space.xl,
    gap: space.lg,
  },
  title: { color: colors.text, fontSize: 22, lineHeight: 30, fontWeight: '700' },
  message: { color: colors.secondaryText, fontSize: 16, lineHeight: 24 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, justifyContent: 'flex-end' },
  action: { flexGrow: 1 },
});
