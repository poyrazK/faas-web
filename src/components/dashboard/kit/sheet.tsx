import type { ReactNode } from 'react';
import { Modal } from '@/components/ui/modal';

const WIDTH = { sm: 'sm:max-w-[420px]', md: 'sm:max-w-[560px]', lg: 'sm:max-w-[720px]' } as const;

/**
 * Where create and edit flows live: a full-height panel from the right edge,
 * so the list it adds to stays in view. The primary action sits in a footer
 * that never scrolls away. Built on `Modal`, so focus, Escape and scroll
 * locking behave the same as every other dialog.
 */
export function Sheet({
  open,
  onClose,
  title,
  size = 'md',
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: keyof typeof WIDTH;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      placement="right"
      width={WIDTH[size]}
      footer={footer}
    >
      {children}
    </Modal>
  );
}
