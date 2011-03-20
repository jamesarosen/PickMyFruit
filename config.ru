$: << File.expand_path('lib', File.dirname(__FILE__))
require 'pick_my_fruit'

use Rack::Static, :urls => ['/js', '/css'], :root => 'public'
run PickMyFruit
