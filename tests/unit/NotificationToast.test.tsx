import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NotificationToast } from '../../src/components/ui/NotificationToast';

describe('NotificationToast', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders the title and message', () => {
    render(<NotificationToast id="1" title="Görev Onaylandı" message="Allah kabul etsin." onClose={() => {}} />);

    expect(screen.getByText('Görev Onaylandı')).toBeInTheDocument();
    expect(screen.getByText('Allah kabul etsin.')).toBeInTheDocument();
  });

  it('calls onClose with its id when the labeled close button is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<NotificationToast id="abc" title="Bilgi" message="Mesaj" onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Kapat' }));
    expect(onClose).toHaveBeenCalledWith('abc');
  });

  it('auto-dismisses itself after the display timeout', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<NotificationToast id="xyz" title="Bilgi" message="Mesaj" onClose={onClose} />);

    expect(onClose).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5500);
    expect(onClose).toHaveBeenCalledWith('xyz');
  });
});
