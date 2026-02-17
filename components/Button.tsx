import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'icon';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  active?: boolean;
  tooltip?: string;
}

export const Button: React.FC<ButtonProps> = ({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  className = '', 
  active = false,
  tooltip,
  ...props 
}) => {
  const baseStyles = "inline-flex items-center justify-center rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 font-medium";
  
  const variants = {
    primary: "bg-primary-600 hover:bg-primary-500 text-white focus:ring-primary-500",
    secondary: "bg-gray-700 hover:bg-gray-600 text-white focus:ring-gray-500",
    danger: "bg-red-600 hover:bg-red-500 text-white focus:ring-red-500",
    ghost: "bg-transparent hover:bg-gray-800 text-gray-300 hover:text-white",
    icon: `rounded-full p-3 ${active ? 'bg-primary-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'}`,
  };

  const sizes = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2 text-sm",
    lg: "px-6 py-3 text-base",
    icon: "p-2",
  };

  const variantStyles = variants[variant];
  // Icon variant handles size differently (via padding)
  const sizeStyles = variant === 'icon' ? '' : sizes[size];

  return (
    <button 
      className={`${baseStyles} ${variantStyles} ${sizeStyles} ${className} disabled:opacity-50 disabled:cursor-not-allowed`}
      title={tooltip}
      {...props}
    >
      {children}
    </button>
  );
};