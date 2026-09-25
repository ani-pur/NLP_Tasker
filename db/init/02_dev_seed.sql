-- Dev-only seed data. Log in as  dev / dev
INSERT INTO public.users (username, pwhash, email) VALUES
    ('dev', 'scrypt:32768:8:1$D92wSqxrQqMIRGwd$4d6a875492276f3be334c0407b2b498748c798c8d9dee06d7c30fcd2045ee969ff6644c919c7ba9d271c58af450284d4670d801c1a5cd72ec2398a9eb86838e2', 'dev@localhost');
