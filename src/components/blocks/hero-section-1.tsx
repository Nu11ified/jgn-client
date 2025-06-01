"use client"

import React from 'react'
import Link from 'next/link'
import { ArrowRight, ChevronRight, Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AnimatedGroup } from '@/components/ui/animated-group'
import { cn } from '@/lib/utils'
import { authClient } from '@/lib/auth-client'
import { ModeToggle } from '@/components/ui/mode-toggle'

const transitionVariants = {
    item: {
        hidden: {
            opacity: 0,
            filter: 'blur(12px)',
            y: 12,
        },
        visible: {
            opacity: 1,
            filter: 'blur(0px)',
            y: 0,
            transition: {
                type: 'spring',
                bounce: 0.3,
                duration: 1.5,
            },
        },
    },
}

export function HeroSection() {
    const { data: session, isPending: isSessionPending } = authClient.useSession();
    return (
        <>
            <HeroHeader />
            <main className="overflow-hidden">
                <div
                    aria-hidden
                    className="z-[2] absolute inset-0 pointer-events-none isolate opacity-50 contain-strict hidden lg:block">
                    <div className="w-[35rem] h-[80rem] -translate-y-[350px] absolute left-0 top-0 -rotate-45 rounded-full bg-[radial-gradient(68.54%_68.72%_at_55.02%_31.46%,hsla(0,0%,85%,.08)_0,hsla(0,0%,55%,.02)_50%,hsla(0,0%,45%,0)_80%)]" />
                    <div className="h-[80rem] absolute left-0 top-0 w-56 -rotate-45 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,hsla(0,0%,85%,.06)_0,hsla(0,0%,45%,.02)_80%,transparent_100%)] [translate:5%_-50%]" />
                    <div className="h-[80rem] -translate-y-[350px] absolute left-0 top-0 w-56 -rotate-45 bg-[radial-gradient(50%_50%_at_50%_50%,hsla(0,0%,85%,.04)_0,hsla(0,0%,45%,.02)_80%,transparent_100%)]" />
                </div>
                <section>
                    <div className="relative pt-24 md:pt-36">
                        <AnimatedGroup
                            variants={{
                                container: {
                                    visible: {
                                        transition: {
                                            delayChildren: 1,
                                        },
                                    },
                                },
                                item: {
                                    hidden: {
                                        opacity: 0,
                                        y: 20,
                                    },
                                    visible: {
                                        opacity: 1,
                                        y: 0,
                                        transition: {
                                            type: 'spring',
                                            bounce: 0.3,
                                            duration: 2,
                                        },
                                    },
                                },
                            }}
                            className="absolute inset-0 -z-20">
                            <img
                                src="lsnight.webp"
                                alt="background"
                                className="absolute inset-x-0 top-56 -z-20 hidden lg:top-32 dark:block"
                                width="3276"
                                height="4095"
                            />
                        </AnimatedGroup>
                        <div aria-hidden className="absolute inset-0 -z-10 size-full [background:radial-gradient(125%_125%_at_50%_100%,transparent_0%,var(--background)_75%)]" />
                        <div className="mx-auto max-w-7xl px-6">
                            <div className="text-center sm:mx-auto lg:mr-auto lg:mt-0">
                                <AnimatedGroup variants={transitionVariants}>
                                    <h1
                                        className="mt-8 max-w-4xl mx-auto text-balance text-6xl md:text-7xl lg:mt-16 xl:text-[5.25rem]">
                                        JGN Panel
                                    </h1>
                                    <p
                                        className="mx-auto mt-8 max-w-2xl text-balance text-lg">
                                        Advanced User Management for JGN
                                    </p>
                                    <p
                                        className="mx-auto mt-4 max-w-2xl text-balance text-md text-muted-foreground">
                                        Easily manage your own credentials, departments, and more.
                                    </p>
                                </AnimatedGroup>

                                <AnimatedGroup
                                    variants={{
                                        container: {
                                            visible: {
                                                transition: {
                                                    staggerChildren: 0.05,
                                                    delayChildren: 0.75,
                                                },
                                            },
                                        },
                                        ...transitionVariants,
                                    }}
                                    className="mt-12 flex flex-col items-center justify-center gap-2 md:flex-row">
                                    <div
                                        key={1}
                                        className="bg-foreground/10 rounded-[14px] border p-0.5">
                                        <Button
                                            asChild
                                            size="lg"
                                            className="rounded-xl px-5 text-base">
                                            {isSessionPending ? (
                                                <Link href="#" aria-disabled="true">
                                                    <span>Loading...</span>
                                                </Link>
                                            ) : session ? (
                                                <Link href="/dashboard">
                                                    <span className="text-nowrap">Dashboard</span>
                                                </Link>
                                            ) : (
                                                <Link href="/auth/login">
                                                    <span className="text-nowrap">Login</span>
                                                </Link>
                                            )}
                                        </Button>
                                    </div>
                                </AnimatedGroup>
                            </div>
                        </div>

                        <AnimatedGroup
                            variants={{
                                container: {
                                    visible: {
                                        transition: {
                                            staggerChildren: 0.05,
                                            delayChildren: 0.75,
                                        },
                                    },
                                },
                                ...transitionVariants,
                            }}>
                            <div className="relative -mr-56 mt-8 overflow-hidden px-2 sm:mr-0 sm:mt-12 md:mt-20">
                                <div
                                    aria-hidden
                                    className="bg-gradient-to-b to-background absolute inset-0 z-10 from-transparent from-35%"
                                />
                                <div className="inset-shadow-2xs ring-background dark:inset-shadow-white/20 bg-background relative mx-auto max-w-6xl overflow-hidden rounded-2xl border p-4 shadow-lg shadow-zinc-950/15 ring-1">
                                    <img
                                        className="bg-background aspect-15/8 relative hidden rounded-2xl dark:block"
                                        src="https://vgrtqyl5lv.ufs.sh/f/Wop2pMdP5jMdReg5GUsjq7byCwOvToM8HYnXDA1r2zUhlRGB"
                                        alt="app screen"
                                        width="2700"
                                        height="1440"
                                    />
                                    <img
                                        className="z-2 border-border/25 aspect-15/8 relative rounded-2xl border dark:hidden"
                                        src="https://vgrtqyl5lv.ufs.sh/f/Wop2pMdP5jMdSQb87edqO7PvVYAseMRyZ5xhIFrz3g2jpBD6"
                                        alt="app screen"
                                        width="2700"
                                        height="1440"
                                    />
                                </div>
                            </div>
                        </AnimatedGroup>
                    </div>
                </section>
                <section className="bg-background pb-16 pt-16 md:pb-32">
                    <div className="group relative m-auto max-w-5xl px-6">
                        <div className="absolute inset-0 z-10 flex scale-95 items-center justify-center opacity-0 duration-500 group-hover:scale-100 group-hover:opacity-100">
                            <Link
                                href="#"
                                className="block text-sm duration-150 hover:opacity-75">
                                <span> Meet Your Departments</span>

                                <ChevronRight className="ml-1 inline-block size-3" />
                            </Link>
                        </div>
                        <div className="group-hover:blur-xs mx-auto mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-6 transition-all duration-500 group-hover:opacity-50 sm:gap-x-12 sm:gap-y-10">
                            {[ "SAST", "BCSO", "LSPD", "SAFD", "JRP Staff"].map((dept) => (
                                <div key={dept} className="flex items-center justify-center rounded-md border bg-card px-4 py-2 text-sm font-medium text-card-foreground shadow-sm">
                                    {dept}
                                </div>
                            ))}
                        </div>
                    </div>
                </section>
            </main>
        </>
    )
}

const NavLink = ({ href, children }: { href: string; children: React.ReactNode }) => (
    <Link href={href} className="text-muted-foreground hover:text-foreground transition-colors">
        {children}
    </Link>
);

export const HeroHeader = () => {
    const [isMenuOpen, setIsMenuOpen] = React.useState(false);
    const { data: session, isPending: isSessionPending } = authClient.useSession();

    return (
        <header className="supports-backdrop-blur:bg-background/60 sticky top-0 z-50 w-full border-b bg-transparent backdrop-blur">
            <nav className="mx-auto flex max-w-7xl items-center justify-between gap-x-6 p-6 lg:px-8" aria-label="Global">
                <div className="flex lg:flex-1">
                    <Link href="/" className="-m-1.5 p-1.5">
                        <Logo />
                        <span className="sr-only">JGN Panel</span>
                    </Link>
                </div>
                <div className="hidden lg:flex lg:gap-x-12">
                    {/* {navItems.map((item) => (
                        <NavLink key={item.label} href={item.href}>
                            {item.label}
                        </NavLink>
                    ))} */}
                </div>
                <div className="flex flex-1 items-center justify-end gap-x-2">
                    {isSessionPending ? (
                        <span className="text-sm text-muted-foreground">Loading...</span>
                    ) : session ? (
                        <>
                            <Button asChild size="sm">
                                <Link href="/dashboard">Dashboard</Link>
                            </Button>
                            <Button asChild variant="outline" size="sm">
                                <Link href="/auth/logout">Logout</Link>
                            </Button>
                        </>
                    ) : (
                        <Button asChild variant="ghost" size="sm">
                            <Link href="/auth/login">Log in</Link>
                        </Button>
                    )}
                    <ModeToggle />
                </div>
                <div className="flex lg:hidden">
                    <button
                        type="button"
                        onClick={() => setIsMenuOpen(true)}
                        className="-m-2.5 inline-flex items-center justify-center rounded-md p-2.5 text-gray-700">
                        <span className="sr-only">Open main menu</span>
                        <Menu className="h-6 w-6" aria-hidden="true" />
                    </button>
                </div>
            </nav>
            {isMenuOpen && (
                <div className="lg:hidden" role="dialog" aria-modal="true">
                    <div className="fixed inset-0 z-10" />
                    <div className="dark:bg-background fixed inset-y-0 right-0 z-50 w-full overflow-y-auto bg-white px-6 py-6 sm:max-w-sm sm:ring-1 sm:ring-gray-900/10">
                        <div className="flex items-center justify-between">
                            <Link href="/" className="-m-1.5 p-1.5">
                                <Logo />
                                <span className="sr-only">JGN Panel</span>
                            </Link>
                            <button
                                type="button"
                                onClick={() => setIsMenuOpen(false)}
                                className="-m-2.5 rounded-md p-2.5 text-gray-700">
                                <span className="sr-only">Close menu</span>
                                <X className="h-6 w-6" aria-hidden="true" />
                            </button>
                        </div>
                        <div className="mt-6 flow-root">
                            <div className="-my-6 divide-y divide-gray-500/10">
                                <div className="space-y-2 py-6">
                                    {/* {navItems.map((item) => (
                                        <Link
                                            key={item.label}
                                            href={item.href}
                                            onClick={() => setIsMenuOpen(false)}
                                            className="-mx-3 block rounded-lg px-3 py-2 text-base font-semibold leading-7 text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-gray-800">
                                            {item.label}
                                        </Link>
                                    ))} */}
                                </div>
                                <div className="py-6">
                                    {isSessionPending ? (
                                        <span className="-mx-3 block rounded-lg px-3 py-2.5 text-base font-semibold leading-7 text-muted-foreground">Loading...</span>
                                    ) : session ? (
                                        <>
                                            <Link
                                                href="/dashboard"
                                                onClick={() => setIsMenuOpen(false)}
                                                className="-mx-3 block rounded-lg px-3 py-2.5 text-base font-semibold leading-7 text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-gray-800">
                                                Dashboard
                                            </Link>
                                            <Link
                                                href="/auth/logout"
                                                onClick={() => setIsMenuOpen(false)}
                                                className="-mx-3 block rounded-lg px-3 py-2.5 text-base font-semibold leading-7 text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-gray-800">
                                                Logout
                                            </Link>
                                        </>
                                    ) : (
                                        <Link
                                            href="/auth/login"
                                            onClick={() => setIsMenuOpen(false)}
                                            className="-mx-3 block rounded-lg px-3 py-2.5 text-base font-semibold leading-7 text-gray-900 hover:bg-gray-50 dark:text-white dark:hover:bg-gray-800">
                                            Log in
                                        </Link>
                                    )}
                                    <div className="mt-4 pl-1">
                                        <ModeToggle />
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </header>
    );
};

const Logo = ({ className }: { className?: string }) => {
    return (
        <img 
            src="https://vgrtqyl5lv.ufs.sh/f/5802499d-8460-4148-ae92-cf3a514df7e7-jlo1cb.png" 
            alt="JGN Panel Logo"
            className={cn('h-12 w-auto rounded-full', className)} 
        />
    );
}