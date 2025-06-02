import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Boxes, BarChartBig, ClipboardList, MousePointerSquareDashed, ArrowRight } from 'lucide-react';

interface Benefit {
  icon: React.ElementType;
  title: string;
  description: string;
}

const benefits: Benefit[] = [
  {
    icon: ClipboardList,
    title: 'Streamlined Tracking',
    description: 'Effortlessly monitor your inventory levels with our intuitive tracking system. Say goodbye to manual counts and spreadsheets.',
  },
  {
    icon: BarChartBig,
    title: 'Real-time Insights',
    description: 'Gain valuable insights into your stock movements and trends with our powerful analytics. Make data-driven decisions with confidence.',
  },
  {
    icon: MousePointerSquareDashed,
    title: 'User-Friendly Interface',
    description: 'Designed for ease of use, StockSight offers a clean and accessible interface, ensuring a smooth experience for all users.',
  },
];

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="py-6 px-4 md:px-8">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Boxes className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold text-primary font-headline">StockSight</h1>
          </div>
          {/* Future navigation links can be added here */}
        </div>
      </header>

      <section className="py-16 md:py-24 flex-grow">
        <div className="container mx-auto text-center">
          <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 font-headline leading-tight">
            Effortless Inventory Management with StockSight
          </h2>
          <p className="text-lg md:text-xl text-muted-foreground mb-10 max-w-2xl mx-auto">
            Gain clarity and control over your stock with our intuitive platform. Streamline operations, reduce waste, and boost profitability.
          </p>
          <Button size="lg" className="font-semibold text-lg px-8 py-6 group">
            Get Started Today
            <ArrowRight className="ml-2 h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" />
          </Button>
          <div className="mt-16 max-w-4xl mx-auto px-4">
            <Image
              src="https://placehold.co/1200x600.png"
              alt="StockSight dashboard preview"
              width={1200}
              height={600}
              className="rounded-xl shadow-2xl object-cover"
              data-ai-hint="inventory management software"
              priority
            />
          </div>
        </div>
      </section>

      <section className="py-16 md:py-24 bg-secondary/30">
        <div className="container mx-auto px-4">
          <h3 className="text-3xl md:text-4xl font-bold text-center mb-16 font-headline">
            Why Choose <span className="text-primary">StockSight</span>?
          </h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {benefits.map((benefit, index) => (
              <Card
                key={index}
                className="text-center shadow-lg hover:shadow-xl transition-all duration-300 ease-in-out transform hover:-translate-y-1 flex flex-col"
              >
                <CardHeader className="items-center">
                  <div className="bg-primary/10 text-primary rounded-full p-4 w-fit mb-4">
                    <benefit.icon className="h-8 w-8" />
                  </div>
                  <CardTitle className="font-headline text-2xl">{benefit.title}</CardTitle>
                </CardHeader>
                <CardContent className="flex-grow">
                  <p className="text-muted-foreground text-base leading-relaxed">{benefit.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <footer className="py-8 border-t mt-auto">
        <div className="container mx-auto text-center text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} StockSight. All rights reserved.</p>
        </div>
      </footer>
    </main>
  );
}
